import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { base64ToBytes, bytesLength, bytesToBase64, valueToBytes } from './encoding';
import type { AppEnv } from './env';
import { canEdit, type ActiveUser, type ClientMessage, type ConnectionAttachment, isRole, type Role, type ServerMessage } from './messages';

type DocumentRow = {
	id: string;
	title: string;
	owner_id: string;
	created_at: string;
	last_modified: string;
};

type StateRow = {
	content: string;
	crdt_snapshot: ArrayBuffer;
	revision: number;
	updated_at: string;
};

type PermissionRow = {
	user_id: string;
	role: Role;
	created_at: string;
};

type ChangeRow = {
	id: number;
	doc_id: string;
	user_id: string;
	old_content: string | null;
	new_content: string | null;
	timestamp: string;
};

type AnalyticsRow = {
	doc_id: string;
	day: string;
	edit_count: number;
	connection_count: number;
	max_active_users: number;
	bytes_in: number;
	bytes_out: number;
};

export type ApiResult<T = unknown> = {
	status: number;
	body: T;
};

const COMPACT_AFTER_UPDATES = 1000;
const COMPACT_AFTER_BYTES = 1024 * 1024;

export class NotebookDocument extends DurableObject<AppEnv> {
	private ydoc: Y.Doc | null = null;
	private docId: string | null = null;

	constructor(ctx: DurableObjectState, env: AppEnv) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(async () => {
			this.createSchema();
		});
	}

	async createDocument(input: { docId: string; title: string; ownerId: string }): Promise<{
		id: string;
		title: string;
		ownerId: string;
		editUrl: string;
		viewUrl: string;
	}> {
		const title = cleanTitle(input.title);
		const snapshot = createEmptySnapshot();
		const content = '';

		this.ctx.storage.sql.exec(
			`
			INSERT OR IGNORE INTO documents (id, title, owner_id)
			VALUES (?, ?, ?)
			`,
			input.docId,
			title,
			input.ownerId,
		);
		this.ctx.storage.sql.exec(
			`
			INSERT OR IGNORE INTO document_state (doc_id, content, crdt_snapshot, revision)
			VALUES (?, ?, ?, 0)
			`,
			input.docId,
			content,
			snapshot,
		);
		this.ctx.storage.sql.exec(
			`
			INSERT OR REPLACE INTO permissions (doc_id, user_id, role)
			VALUES (?, ?, 'owner')
			`,
			input.docId,
			input.ownerId,
		);

		this.docId = input.docId;
		this.ydoc = createDocFromSnapshot(snapshot);

		return {
			id: input.docId,
			title,
			ownerId: input.ownerId,
			editUrl: `/documents/${input.docId}`,
			viewUrl: `/documents/${input.docId}`,
		};
	}

	async getDocument(input: { docId: string; userId: string }): Promise<ApiResult> {
		const role = this.getRole(input.docId, input.userId);
		if (!role) {
			return apiResult({ error: 'Document not found or not shared with this user.' }, 404);
		}

		const document = this.getDocumentRow(input.docId);
		const state = this.getStateRow(input.docId);
		if (!document || !state) {
			return apiResult({ error: 'Document not found.' }, 404);
		}

		return apiResult({
			id: document.id,
			title: document.title,
			ownerId: document.owner_id,
			createdAt: document.created_at,
			lastModified: document.last_modified,
			content: state.content,
			revision: state.revision,
			role,
			activeUsers: this.getActiveUsers(),
		});
	}

	async updateTitle(input: { docId: string; userId: string; title: string }): Promise<ApiResult> {
		const role = this.getRole(input.docId, input.userId);
		if (!canEditRole(role)) {
			return apiResult({ error: 'Only owners and editors can rename documents.' }, 403);
		}

		const title = cleanTitle(input.title);
		this.ctx.storage.sql.exec(
			`
			UPDATE documents
			SET title = ?, last_modified = CURRENT_TIMESTAMP
			WHERE id = ?
			`,
			title,
			input.docId,
		);
		this.broadcast({
			type: 'title',
			title,
			from: input.userId,
		});
		return apiResult({ title });
	}

	async getHistory(input: { docId: string; userId: string }): Promise<ApiResult> {
		const role = this.getRole(input.docId, input.userId);
		if (!role) {
			return apiResult({ error: 'Document not found or not shared with this user.' }, 404);
		}

		const rows = this.ctx.storage.sql
			.exec<ChangeRow>(
				`
				SELECT id, doc_id, user_id, old_content, new_content, timestamp
				FROM changes
				WHERE doc_id = ?
				ORDER BY id DESC
				LIMIT 100
				`,
				input.docId,
			)
			.toArray();

		return apiResult({ changes: rows });
	}

	async revert(input: { docId: string; userId: string; changeId: number; target: 'old' | 'new' }): Promise<ApiResult> {
		const role = this.getRole(input.docId, input.userId);
		if (!canEditRole(role)) {
			return apiResult({ error: 'Only owners and editors can revert changes.' }, 403);
		}

		const change = this.ctx.storage.sql
			.exec<ChangeRow>(
				`
				SELECT id, doc_id, user_id, old_content, new_content, timestamp
				FROM changes
				WHERE doc_id = ? AND id = ?
				`,
				input.docId,
				input.changeId,
			)
			.one();
		const content = input.target === 'old' ? change.old_content : change.new_content;
		if (content === null) {
			return apiResult({ error: 'Selected history entry cannot be reverted.' }, 400);
		}

		await this.ensureLoaded(input.docId);
		const result = this.replaceContent(input.docId, input.userId, content);
		this.broadcast({
			type: 'update',
			content: result.content,
			update: bytesToBase64(result.update),
			from: input.userId,
			revision: result.revision,
		});
		return apiResult({ content: result.content, revision: result.revision });
	}

	async listPermissions(input: { docId: string; userId: string }): Promise<ApiResult> {
		const role = this.getRole(input.docId, input.userId);
		if (role !== 'owner') {
			return apiResult({ error: 'Only owners can view permission grants.' }, 403);
		}

		const permissions = this.ctx.storage.sql
			.exec<PermissionRow>(
				`
				SELECT user_id, role, created_at
				FROM permissions
				WHERE doc_id = ?
				ORDER BY role, user_id
				`,
				input.docId,
			)
			.toArray();
		return apiResult({ permissions });
	}

	async grantPermission(input: {
		docId: string;
		actorId: string;
		targetUserId: string;
		role: 'editor' | 'viewer';
		systemGrant?: boolean;
	}): Promise<ApiResult> {
		if (!input.systemGrant) {
			const actorRole = this.getRole(input.docId, input.actorId);
			if (actorRole !== 'owner') {
				return apiResult({ error: 'Only owners can manage permissions.' }, 403);
			}
		}

		this.ctx.storage.sql.exec(
			`
			INSERT INTO permissions (doc_id, user_id, role)
			VALUES (?, ?, ?)
			ON CONFLICT(doc_id, user_id) DO UPDATE SET role = excluded.role
			`,
			input.docId,
			input.targetUserId,
			input.role,
		);
		this.broadcastUsers();
		return apiResult({ docId: input.docId, userId: input.targetUserId, role: input.role });
	}

	async getRoleForUser(input: { docId: string; userId: string }): Promise<Role | null> {
		return this.getRole(input.docId, input.userId);
	}

	async getAnalytics(input: { docId: string; userId: string }): Promise<ApiResult> {
		const role = this.getRole(input.docId, input.userId);
		if (!role) {
			return apiResult({ error: 'Document not found or not shared with this user.' }, 404);
		}

		const day = today();
		const analytics =
			this.ctx.storage.sql
				.exec<AnalyticsRow>(
					`
					SELECT doc_id, day, edit_count, connection_count, max_active_users, bytes_in, bytes_out
					FROM analytics_daily
					WHERE doc_id = ? AND day = ?
					`,
					input.docId,
					day,
				)
				.toArray()[0] ?? defaultAnalytics(input.docId, day);

		return apiResult({ analytics, activeUsers: this.getActiveUsers() });
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Upgrade required', { status: 400 });
		}

		const url = new URL(request.url);
		const docId = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
		const userId = url.searchParams.get('userId') ?? '';
		const name = url.searchParams.get('name') ?? 'Anonymous';
		if (!docId || !userId) {
			return new Response('Missing document or user', { status: 400 });
		}

		const role = this.getRole(docId, userId);
		if (!role) {
			return new Response('Forbidden', { status: 403 });
		}

		await this.ensureLoaded(docId);
		const document = this.getDocumentRow(docId);
		const state = this.getStateRow(docId);
		if (!document || !state) {
			return new Response('Document not found', { status: 404 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({
			docId,
			userId,
			name,
			role,
			cursor: null,
			selection: null,
			connectedAt: Date.now(),
		} satisfies ConnectionAttachment);

		this.incrementAnalytics(docId, { connectionCount: 1, maxActiveUsers: this.getActiveUsers().length + 1 });
		this.send(server, {
			type: 'init',
			title: document.title,
			content: state.content,
			snapshot: bytesToBase64(valueToBytes(state.crdt_snapshot)),
			revision: state.revision,
			users: this.getActiveUsers(),
		});
		this.broadcastUsers();

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const attachment = this.getAttachment(ws);
		if (!attachment) {
			this.sendError(ws, 'not_initialized', 'Connection state is unavailable.');
			return;
		}
		await this.ensureLoaded(attachment.docId);

		if (typeof message !== 'string') {
			this.sendError(ws, 'invalid_message', 'Only JSON text WebSocket messages are accepted.');
			return;
		}

		this.incrementAnalytics(attachment.docId, { bytesIn: message.length });

		let parsed: unknown;
		try {
			parsed = JSON.parse(message);
		} catch {
			this.sendError(ws, 'invalid_json', 'Message must be valid JSON.');
			return;
		}

		const messages = isBatch(parsed) ? parsed.messages : [parsed];
		for (const item of messages) {
			await this.handleClientMessage(ws, attachment, item);
		}
	}

	async webSocketClose(): Promise<void> {
		this.broadcastUsers();
	}

	async webSocketError(): Promise<void> {
		this.broadcastUsers();
	}

	private async handleClientMessage(ws: WebSocket, attachment: ConnectionAttachment, raw: unknown): Promise<void> {
		if (!isClientMessage(raw)) {
			this.sendError(ws, 'invalid_message', 'Unsupported message type or payload.');
			return;
		}

		if (raw.type === 'ping') {
			this.send(ws, { type: 'pong', serverTs: Date.now(), clientTs: raw.clientTs });
			return;
		}

		if (raw.type === 'cursor') {
			const cursor = normalizePosition(raw.pos);
			const selection = raw.selection ? { anchor: normalizePosition(raw.selection.anchor), head: normalizePosition(raw.selection.head) } : null;
			ws.serializeAttachment({ ...attachment, cursor, selection });
			this.broadcastExcept(ws, { type: 'cursor', userId: attachment.userId, pos: cursor, selection });
			this.broadcastUsers();
			return;
		}

		if (!canEdit(attachment.role)) {
			this.sendError(ws, 'forbidden', 'Viewers cannot edit this document.');
			return;
		}

			await this.ensureLoaded(attachment.docId);
			let result: { content: string; update: Uint8Array; revision: number };
			try {
				if (raw.update) {
					result = this.applyCrdtUpdate(attachment.docId, attachment.userId, base64ToBytes(raw.update));
				} else if (typeof raw.content === 'string') {
					result = this.replaceContent(attachment.docId, attachment.userId, raw.content);
				} else {
				this.sendError(ws, 'invalid_edit', 'Edit messages require either update or content.');
				return;
			}
		} catch (error) {
			this.sendError(ws, 'storage_error', error instanceof Error ? error.message : 'Edit could not be persisted.');
			return;
		}

		this.broadcast({
			type: 'update',
			content: result.content,
			update: bytesToBase64(result.update),
			from: attachment.userId,
			revision: result.revision,
		});
		this.send(ws, { type: 'ack', clientSeq: raw.clientSeq, clientTs: raw.clientTs, revision: result.revision, serverTs: Date.now() });
	}

	private applyCrdtUpdate(docId: string, userId: string, update: Uint8Array): { content: string; update: Uint8Array; revision: number } {
		const ydoc = this.mustGetDoc();
		const oldContent = ydoc.getText('body').toString();
		Y.applyUpdate(ydoc, update, 'remote');
		const newContent = ydoc.getText('body').toString();
		return this.persistEdit(docId, userId, oldContent, newContent, update);
	}

	private replaceContent(docId: string, userId: string, content: string): { content: string; update: Uint8Array; revision: number } {
		const ydoc = this.mustGetDoc();
		const body = ydoc.getText('body');
		const oldContent = body.toString();
		let update: Uint8Array | null = null;
		const capture = (captured: Uint8Array): void => {
			update = captured;
		};
		ydoc.once('update', capture);
		ydoc.transact(() => {
			body.delete(0, body.length);
			body.insert(0, content);
		}, 'legacy');
		if (!update) {
			update = Y.encodeStateAsUpdate(ydoc);
		}
		return this.persistEdit(docId, userId, oldContent, body.toString(), update);
	}

	private persistEdit(
		docId: string,
		userId: string,
		oldContent: string,
		newContent: string,
		update: Uint8Array,
	): { content: string; update: Uint8Array; revision: number } {
		const current = this.getStateRow(docId);
		if (!current) {
			throw new Error('Document state is missing.');
		}

		const revision = current.revision + 1;
		const snapshot = Y.encodeStateAsUpdate(this.mustGetDoc());

		this.ctx.storage.sql.exec(
			`
			INSERT INTO changes (doc_id, user_id, old_content, new_content)
			VALUES (?, ?, ?, ?)
			`,
			docId,
			userId,
			oldContent,
			newContent,
		);
		this.ctx.storage.sql.exec(
			`
			INSERT INTO crdt_updates (doc_id, user_id, revision, update_blob)
			VALUES (?, ?, ?, ?)
			`,
			docId,
			userId,
			revision,
			update,
		);
		this.ctx.storage.sql.exec(
			`
			UPDATE document_state
			SET content = ?, crdt_snapshot = ?, revision = ?, updated_at = CURRENT_TIMESTAMP
			WHERE doc_id = ?
			`,
			newContent,
			snapshot,
			revision,
			docId,
		);
		this.ctx.storage.sql.exec(
			`
			UPDATE documents
			SET last_modified = CURRENT_TIMESTAMP
			WHERE id = ?
			`,
			docId,
		);
		this.incrementAnalytics(docId, { editCount: 1, bytesIn: bytesLength(update) });
		this.compactIfNeeded(docId);

		return { content: newContent, update, revision };
	}

	private async ensureLoaded(docId: string): Promise<void> {
		if (this.ydoc && this.docId === docId) {
			return;
		}

		const state = this.getStateRow(docId);
		if (!state) {
			throw new Error('Document state is missing.');
		}
		this.ydoc = createDocFromSnapshot(valueToBytes(state.crdt_snapshot));
		this.docId = docId;
	}

	private createSchema(): void {
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS documents (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				owner_id TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				last_modified DATETIME DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS changes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				doc_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				old_content TEXT,
				new_content TEXT,
				timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (doc_id) REFERENCES documents(id)
			);
			CREATE TABLE IF NOT EXISTS document_state (
				doc_id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				crdt_snapshot BLOB NOT NULL,
				revision INTEGER NOT NULL DEFAULT 0,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS crdt_updates (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				doc_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				revision INTEGER NOT NULL,
				update_blob BLOB NOT NULL,
				timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS permissions (
				doc_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (doc_id, user_id)
			);
			CREATE TABLE IF NOT EXISTS analytics_daily (
				doc_id TEXT NOT NULL,
				day TEXT NOT NULL,
				edit_count INTEGER NOT NULL DEFAULT 0,
				connection_count INTEGER NOT NULL DEFAULT 0,
				max_active_users INTEGER NOT NULL DEFAULT 0,
				bytes_in INTEGER NOT NULL DEFAULT 0,
				bytes_out INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (doc_id, day)
			);
		`);
	}

	private getDocumentRow(docId: string): DocumentRow | null {
		return (
			this.ctx.storage.sql
				.exec<DocumentRow>(
					`
					SELECT id, title, owner_id, created_at, last_modified
					FROM documents
					WHERE id = ?
					`,
					docId,
				)
				.toArray()[0] ?? null
		);
	}

	private getStateRow(docId: string): StateRow | null {
		return (
			this.ctx.storage.sql
				.exec<StateRow>(
					`
					SELECT content, crdt_snapshot, revision, updated_at
					FROM document_state
					WHERE doc_id = ?
					`,
					docId,
				)
				.toArray()[0] ?? null
		);
	}

	private getRole(docId: string, userId: string): Role | null {
		const row = this.ctx.storage.sql
			.exec<{ role: string }>(
				`
				SELECT role
				FROM permissions
				WHERE doc_id = ? AND user_id = ?
				`,
				docId,
				userId,
			)
			.toArray()[0];
		return row && isRole(row.role) ? row.role : null;
	}

	private compactIfNeeded(docId: string): void {
		const stats = this.ctx.storage.sql
			.exec<{ count: number; bytes: number | null }>(
				`
				SELECT COUNT(*) AS count, SUM(LENGTH(update_blob)) AS bytes
				FROM crdt_updates
				WHERE doc_id = ?
				`,
				docId,
			)
			.one();
		if (stats.count < COMPACT_AFTER_UPDATES && (stats.bytes ?? 0) < COMPACT_AFTER_BYTES) {
			return;
		}

		this.ctx.storage.sql.exec('DELETE FROM crdt_updates WHERE doc_id = ?', docId);
	}

	private incrementAnalytics(
		docId: string,
		input: { editCount?: number; connectionCount?: number; maxActiveUsers?: number; bytesIn?: number; bytesOut?: number },
	): void {
		const day = today();
		this.ctx.storage.sql.exec(
			`
			INSERT INTO analytics_daily (doc_id, day, edit_count, connection_count, max_active_users, bytes_in, bytes_out)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(doc_id, day) DO UPDATE SET
				edit_count = edit_count + excluded.edit_count,
				connection_count = connection_count + excluded.connection_count,
				max_active_users = MAX(max_active_users, excluded.max_active_users),
				bytes_in = bytes_in + excluded.bytes_in,
				bytes_out = bytes_out + excluded.bytes_out
			`,
			docId,
			day,
			input.editCount ?? 0,
			input.connectionCount ?? 0,
			input.maxActiveUsers ?? 0,
			input.bytesIn ?? 0,
			input.bytesOut ?? 0,
		);
	}

	private broadcast(message: ServerMessage): void {
		const data = JSON.stringify(message);
		let sent = 0;
		for (const socket of this.ctx.getWebSockets()) {
			if (this.trySend(socket, data)) {
				sent += 1;
			}
		}
		if (this.docId) {
			this.incrementAnalytics(this.docId, { bytesOut: data.length * sent });
		}
	}

	private broadcastExcept(sender: WebSocket, message: ServerMessage): void {
		const data = JSON.stringify(message);
		let sent = 0;
		for (const socket of this.ctx.getWebSockets()) {
			if (socket !== sender && this.trySend(socket, data)) {
				sent += 1;
			}
		}
		if (this.docId) {
			this.incrementAnalytics(this.docId, { bytesOut: data.length * sent });
		}
	}

	private broadcastUsers(): void {
		this.broadcast({ type: 'users', active: this.getActiveUsers() });
	}

	private send(ws: WebSocket, message: ServerMessage): void {
		const data = JSON.stringify(message);
		if (!this.trySend(ws, data)) {
			return;
		}
		if (this.docId) {
			this.incrementAnalytics(this.docId, { bytesOut: data.length });
		}
	}

	private sendError(ws: WebSocket, code: string, message: string): void {
		this.send(ws, { type: 'error', code, message });
	}

	private getActiveUsers(): ActiveUser[] {
		const users = new Map<string, ActiveUser>();
		for (const socket of this.ctx.getWebSockets()) {
			if (socket.readyState !== WebSocket.OPEN) {
				continue;
			}
			const attachment = this.getAttachment(socket);
			if (attachment) {
				users.set(attachment.userId, {
					id: attachment.userId,
					name: attachment.name,
					role: attachment.role,
					pos: attachment.cursor,
					selection: attachment.selection,
				});
			}
		}
		return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	private trySend(socket: WebSocket, data: string): boolean {
		if (socket.readyState !== WebSocket.OPEN) {
			return false;
		}

		try {
			socket.send(data);
			return true;
		} catch {
			return false;
		}
	}

	private getAttachment(ws: WebSocket): ConnectionAttachment | null {
		const attachment = ws.deserializeAttachment();
		if (!attachment || typeof attachment !== 'object') {
			return null;
		}
			const candidate = attachment as Partial<ConnectionAttachment>;
			const docId = typeof candidate.docId === 'string' ? candidate.docId : this.docId;
			if (
				typeof docId !== 'string' ||
				typeof candidate.userId !== 'string' ||
				typeof candidate.name !== 'string' ||
			!candidate.role ||
			!isRole(candidate.role) ||
			typeof candidate.connectedAt !== 'number'
		) {
			return null;
			}
			return {
				docId,
				userId: candidate.userId,
				name: candidate.name,
			role: candidate.role,
			cursor: typeof candidate.cursor === 'number' ? candidate.cursor : null,
			selection: candidate.selection ?? null,
			connectedAt: candidate.connectedAt,
		};
	}

	private mustGetDoc(): Y.Doc {
		if (!this.ydoc) {
			throw new Error('Yjs document has not been loaded.');
		}
		return this.ydoc;
	}
}

function createDocFromSnapshot(snapshot: Uint8Array): Y.Doc {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, snapshot);
	doc.getText('body');
	return doc;
}

function createEmptySnapshot(): Uint8Array {
	const doc = new Y.Doc();
	const snapshot = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return snapshot;
}

function cleanTitle(title: string): string {
	const trimmed = title.trim().slice(0, 120);
	return trimmed || 'Untitled notebook';
}

function canEditRole(role: Role | null): role is 'owner' | 'editor' {
	return role === 'owner' || role === 'editor';
}

function normalizePosition(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isClientMessage(value: unknown): value is ClientMessage {
	if (!value || typeof value !== 'object' || !('type' in value)) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.type === 'edit') {
		return (
			(candidate.update === undefined || typeof candidate.update === 'string') &&
			(candidate.content === undefined || typeof candidate.content === 'string') &&
			(candidate.clientSeq === undefined || typeof candidate.clientSeq === 'number') &&
			(candidate.clientTs === undefined || typeof candidate.clientTs === 'number')
		);
	}
	if (candidate.type === 'cursor') {
		return typeof candidate.pos === 'number';
	}
	if (candidate.type === 'ping') {
		return candidate.clientTs === undefined || typeof candidate.clientTs === 'number';
	}
	return false;
}

function isBatch(value: unknown): value is { messages: unknown[] } {
	return !!value && typeof value === 'object' && Array.isArray((value as { messages?: unknown }).messages);
}

function apiResult<T>(body: T, status = 200): ApiResult<T> {
	return { body, status };
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function defaultAnalytics(docId: string, day: string): AnalyticsRow {
	return {
		doc_id: docId,
		day,
		edit_count: 0,
		connection_count: 0,
		max_active_users: 0,
		bytes_in: 0,
		bytes_out: 0,
	};
}
