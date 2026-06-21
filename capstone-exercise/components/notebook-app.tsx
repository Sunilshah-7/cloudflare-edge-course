'use client';

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

type Role = 'owner' | 'editor' | 'viewer';

type Selection = {
	anchor: number;
	head: number;
};

type ActiveUser = {
	id: string;
	name: string;
	role: Role;
	pos: number | null;
	selection: Selection | null;
};

type Session = {
	userId: string;
	name: string;
	expiresAt: number;
};

type DocumentDetails = {
	id: string;
	title: string;
	ownerId: string;
	content: string;
	revision: number;
	role: Role;
	activeUsers: ActiveUser[];
};

type Change = {
	id: number;
	doc_id: string;
	user_id: string;
	old_content: string | null;
	new_content: string | null;
	timestamp: string;
};

type Analytics = {
	edit_count: number;
	connection_count: number;
	max_active_users: number;
	bytes_in: number;
	bytes_out: number;
};

type ServerMessage =
	| { type: 'init'; content: string; snapshot: string; revision: number; users: ActiveUser[] }
	| { type: 'update'; content: string; update: string; from: string; revision: number }
	| { type: 'cursor'; userId: string; pos: number; selection: Selection | null }
	| { type: 'users'; active: ActiveUser[] }
	| { type: 'ack'; clientSeq?: number; revision: number; serverTs: number; clientTs?: number }
	| { type: 'pong'; serverTs: number; clientTs?: number }
	| { type: 'error'; code: string; message: string };

const cursorEffect = StateEffect.define<ActiveUser[]>();

class CursorWidget extends WidgetType {
	constructor(private readonly user: ActiveUser) {
		super();
	}

	toDOM(): HTMLElement {
		const cursor = document.createElement('span');
		cursor.className = 'remoteCursor';
		cursor.dataset.name = this.user.name;
		return cursor;
	}
}

const cursorField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(value, transaction) {
		let next = value.map(transaction.changes);
		for (const effect of transaction.effects) {
			if (effect.is(cursorEffect)) {
				next = Decoration.set(
					effect.value
						.filter((user) => typeof user.pos === 'number')
						.map((user) =>
							Decoration.widget({
								widget: new CursorWidget(user),
								side: 1,
							}).range(Math.min(user.pos ?? 0, transaction.state.doc.length)),
						),
					true,
				);
			}
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

export function NotebookApp() {
	const editorHostRef = useRef<HTMLDivElement | null>(null);
	const editorRef = useRef<EditorView | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const ydocRef = useRef(new Y.Doc());
	const ytextRef = useRef(ydocRef.current.getText('body'));
	const applyingRemoteRef = useRef(false);
	const roleRef = useRef<Role | null>(null);
	const pendingUpdatesRef = useRef<string[]>([]);
	const flushTimerRef = useRef<number | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const clientSeqRef = useRef(0);

	const [session, setSession] = useState<Session | null>(null);
	const [displayName, setDisplayName] = useState('Notebook User');
	const [docId, setDocId] = useState<string | null>(null);
	const [documentDetails, setDocumentDetails] = useState<DocumentDetails | null>(null);
	const [connection, setConnection] = useState('Disconnected');
	const [connectionState, setConnectionState] = useState<'default' | 'connected' | 'error'>('default');
	const [revision, setRevision] = useState(0);
	const [users, setUsers] = useState<ActiveUser[]>([]);
	const [history, setHistory] = useState<Change[]>([]);
	const [analytics, setAnalytics] = useState<Analytics | null>(null);
	const [permissions, setPermissions] = useState<Array<{ user_id: string; role: Role }>>([]);
	const [grantUserId, setGrantUserId] = useState('');
	const [grantRole, setGrantRole] = useState<'viewer' | 'editor'>('viewer');
	const [title, setTitle] = useState('Untitled notebook');
	const [toast, setToast] = useState<string | null>(null);
	const [latencySamples, setLatencySamples] = useState<number[]>([]);

	const role = documentDetails?.role ?? null;
	const canEdit = role === 'owner' || role === 'editor';
	const p95Latency = useMemo(() => {
		if (latencySamples.length === 0) {
			return null;
		}
		const sorted = [...latencySamples].sort((a, b) => a - b);
		return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
	}, [latencySamples]);

	useEffect(() => {
		roleRef.current = role;
	}, [role]);

	const showToast = useCallback((message: string) => {
		setToast(message);
		window.setTimeout(() => setToast(null), 3000);
	}, []);

	const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
		const response = await fetch(path, {
			...init,
			headers: {
				'Content-Type': 'application/json',
				...(init.headers ?? {}),
			},
		});
		if (!response.ok) {
			const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
			throw new Error(body.error ?? response.statusText);
		}
		return (await response.json()) as T;
	}, []);

	const setEditorContent = useCallback((content: string) => {
		const editor = editorRef.current;
		if (!editor || editor.state.doc.toString() === content) {
			return;
		}
		applyingRemoteRef.current = true;
		editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
		applyingRemoteRef.current = false;
	}, []);

	const flushUpdates = useCallback(() => {
		flushTimerRef.current = null;
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN || pendingUpdatesRef.current.length === 0) {
			return;
		}
		const messages = pendingUpdatesRef.current.splice(0).map((update) => ({
			type: 'edit',
			update,
			clientSeq: ++clientSeqRef.current,
			clientTs: Date.now(),
		}));
		ws.send(JSON.stringify(messages.length === 1 ? messages[0] : { messages, timestamp: Date.now() }));
	}, []);

	const sendCursor = useCallback(() => {
		const ws = wsRef.current;
		const editor = editorRef.current;
		if (!ws || !editor || ws.readyState !== WebSocket.OPEN) {
			return;
		}
		const selection = editor.state.selection.main;
		ws.send(
			JSON.stringify({
				type: 'cursor',
				pos: selection.head,
				selection: { anchor: selection.anchor, head: selection.head },
			}),
		);
	}, []);

	const refreshHistory = useCallback(async () => {
		if (!docId) {
			return;
		}
		const data = await api<{ changes: Change[] }>(`/api/documents/${encodeURIComponent(docId)}/history`);
		setHistory(data.changes);
	}, [api, docId]);

	const refreshAnalytics = useCallback(async () => {
		if (!docId) {
			return;
		}
		const data = await api<{ analytics: Analytics }>(`/api/documents/${encodeURIComponent(docId)}/analytics`);
		setAnalytics(data.analytics);
	}, [api, docId]);

	const refreshPermissions = useCallback(async () => {
		if (!docId || role !== 'owner') {
			setPermissions([]);
			return;
		}
		const data = await api<{ permissions: Array<{ user_id: string; role: Role }> }>(
			`/api/documents/${encodeURIComponent(docId)}/permissions`,
		);
		setPermissions(data.permissions);
	}, [api, docId, role]);

	const openDocument = useCallback(
		async (id: string) => {
			const details = await api<DocumentDetails>(`/api/documents/${encodeURIComponent(id)}`);
			setDocumentDetails(details);
			setTitle(details.title);
			setRevision(details.revision);
			setUsers(details.activeUsers);
			setEditorContent(details.content);
		},
		[api, setEditorContent],
	);

	const ensureSession = useCallback(async () => {
		const name = displayName || window.localStorage.getItem('notebook.name') || 'Notebook User';
		window.localStorage.setItem('notebook.name', name);
		const nextSession = await api<Session>('/api/session', {
			method: 'POST',
			body: JSON.stringify({ name }),
		});
		setSession(nextSession);
		setDisplayName(nextSession.name);
		showToast(`Signed in as ${nextSession.name}`);
		return nextSession;
	}, [api, displayName, showToast]);

	const createDocument = useCallback(async () => {
		const created = await api<{ id: string; title: string }>('/api/documents', {
			method: 'POST',
			body: JSON.stringify({ title: 'Untitled notebook' }),
		});
		setDocId(created.id);
		window.localStorage.setItem('notebook.docId', created.id);
		window.history.replaceState(null, '', `/?doc=${encodeURIComponent(created.id)}`);
		await openDocument(created.id);
	}, [api, openDocument]);

	const connectWebSocket = useCallback(() => {
		if (!docId) {
			return;
		}
		wsRef.current?.close();
		if (reconnectTimerRef.current) {
			window.clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(`${protocol}//${window.location.host}/edit/${encodeURIComponent(docId)}`);
		wsRef.current = socket;
		setConnection('Connecting');
		setConnectionState('default');

		socket.addEventListener('open', () => {
			setConnection('Connected');
			setConnectionState('connected');
			socket.send(JSON.stringify({ type: 'ping', clientTs: Date.now() }));
		});

		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data)) as ServerMessage;
			if (message.type === 'init') {
				setRevision(message.revision);
				setUsers(message.users.filter((user) => user.id !== session?.userId));
				applyingRemoteRef.current = true;
				Y.applyUpdate(ydocRef.current, base64ToBytes(message.snapshot), 'server');
				setEditorContent(message.content);
				applyingRemoteRef.current = false;
			} else if (message.type === 'update') {
				setRevision(message.revision);
				applyingRemoteRef.current = true;
				Y.applyUpdate(ydocRef.current, base64ToBytes(message.update), 'server');
				setEditorContent(message.content);
				applyingRemoteRef.current = false;
			} else if (message.type === 'cursor') {
				setUsers((current) =>
					current.map((user) =>
						user.id === message.userId ? { ...user, pos: message.pos, selection: message.selection } : user,
					),
				);
			} else if (message.type === 'users') {
				setUsers(message.active.filter((user) => user.id !== session?.userId));
			} else if (message.type === 'ack' || message.type === 'pong') {
				if (message.clientTs) {
					const clientTs = message.clientTs;
					setLatencySamples((current) => [...current, Date.now() - clientTs].slice(-20));
				}
				if ('revision' in message && message.revision) {
					setRevision(message.revision);
				}
			} else if (message.type === 'error') {
				showToast(message.message);
			}
		});

		socket.addEventListener('close', () => {
			setConnection('Disconnected');
			setConnectionState('default');
			reconnectTimerRef.current = window.setTimeout(connectWebSocket, 1000 + Math.floor(Math.random() * 1000));
		});

		socket.addEventListener('error', () => {
			setConnection('Connection error');
			setConnectionState('error');
		});
	}, [docId, session?.userId, setEditorContent, showToast]);

	const saveTitle = useCallback(async () => {
		if (!docId) {
			return;
		}
		const data = await api<{ title: string }>(`/api/documents/${encodeURIComponent(docId)}`, {
			method: 'PATCH',
			body: JSON.stringify({ title }),
		});
		setDocumentDetails((current) => (current ? { ...current, title: data.title } : current));
		showToast('Title saved');
	}, [api, docId, showToast, title]);

	const revertChange = useCallback(
		async (changeId: number, target: 'old' | 'new') => {
			if (!docId) {
				return;
			}
			const data = await api<{ content: string; revision: number }>(`/api/documents/${encodeURIComponent(docId)}/revert`, {
				method: 'POST',
				body: JSON.stringify({ changeId, target }),
			});
			setEditorContent(data.content);
			setRevision(data.revision);
			await refreshHistory();
		},
		[api, docId, refreshHistory, setEditorContent],
	);

	const grantPermission = useCallback(async () => {
		if (!docId || !grantUserId.trim()) {
			showToast('Enter a user ID first');
			return;
		}
		await api(`/api/documents/${encodeURIComponent(docId)}/permissions/${encodeURIComponent(grantUserId.trim())}`, {
			method: 'PUT',
			body: JSON.stringify({ role: grantRole }),
		});
		setGrantUserId('');
		await refreshPermissions();
	}, [api, docId, grantRole, grantUserId, refreshPermissions, showToast]);

	const createShareLink = useCallback(async () => {
		if (!docId) {
			return;
		}
		const roleText = window.prompt('Share as viewer or editor?', 'viewer');
		if (roleText !== 'viewer' && roleText !== 'editor') {
			return;
		}
		const data = await api<{ url: string }>(`/api/documents/${encodeURIComponent(docId)}/share`, {
			method: 'POST',
			body: JSON.stringify({ role: roleText }),
		});
		await navigator.clipboard.writeText(new URL(data.url, window.location.href).href);
		showToast('Share link copied');
	}, [api, docId, showToast]);

	useEffect(() => {
		setDisplayName(window.localStorage.getItem('notebook.name') ?? 'Notebook User');
		const params = new URL(window.location.href).searchParams;
		setDocId(params.get('doc') ?? window.localStorage.getItem('notebook.docId'));
	}, []);

	useEffect(() => {
		if (!editorHostRef.current || editorRef.current) {
			return;
		}

		const editor = new EditorView({
			doc: '',
			parent: editorHostRef.current,
			extensions: [
				basicSetup,
				cursorField,
				EditorView.lineWrapping,
				EditorView.updateListener.of((update) => {
					if (!update.docChanged || applyingRemoteRef.current || !(roleRef.current === 'owner' || roleRef.current === 'editor')) {
						return;
					}
					const content = update.state.doc.toString();
					ydocRef.current.transact(() => {
						const text = ytextRef.current;
						text.delete(0, text.length);
						text.insert(0, content);
					}, 'local');
					sendCursor();
				}),
			],
		});

		editorRef.current = editor;
		const onKeyup = throttle(sendCursor, 100);
		const onMouseup = throttle(sendCursor, 100);
		editor.dom.addEventListener('keyup', onKeyup);
		editor.dom.addEventListener('mouseup', onMouseup);

		return () => {
			editor.dom.removeEventListener('keyup', onKeyup);
			editor.dom.removeEventListener('mouseup', onMouseup);
			editor.destroy();
			editorRef.current = null;
		};
	}, [sendCursor]);

	useEffect(() => {
		const ydoc = ydocRef.current;
		const text = ytextRef.current;
		const onUpdate = (update: Uint8Array, origin: unknown) => {
			if (origin !== 'local') {
				return;
			}
			pendingUpdatesRef.current.push(bytesToBase64(update));
			if (!flushTimerRef.current) {
				flushTimerRef.current = window.setTimeout(flushUpdates, 75);
			}
		};
		const onTextChange = () => {
			if (applyingRemoteRef.current) {
				setEditorContent(text.toString());
			}
		};
		ydoc.on('update', onUpdate);
		text.observe(onTextChange);
		return () => {
			ydoc.off('update', onUpdate);
			text.unobserve(onTextChange);
		};
	}, [flushUpdates, setEditorContent]);

	useEffect(() => {
		void (async () => {
			if (session) {
				return;
			}
			const params = new URL(window.location.href).searchParams;
			const share = params.get('share');
			await ensureSession();
			if (share) {
				await api('/api/share/accept', {
					method: 'POST',
					body: JSON.stringify({ token: share }),
				});
				const payload = JSON.parse(atob(share.split('.')[0].replaceAll('-', '+').replaceAll('_', '/'))) as { docId: string };
				setDocId(payload.docId);
				window.localStorage.setItem('notebook.docId', payload.docId);
				window.history.replaceState(null, '', `/?doc=${encodeURIComponent(payload.docId)}`);
			}
		})().catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Startup failed'));
	}, [api, ensureSession, session, showToast]);

	useEffect(() => {
		if (!session) {
			return;
		}
		void (async () => {
			if (docId) {
				await openDocument(docId);
			} else {
				await createDocument();
			}
		})().catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Document failed to load'));
	}, [createDocument, docId, openDocument, session, showToast]);

	useEffect(() => {
		if (!documentDetails) {
			return;
		}
		connectWebSocket();
		void refreshHistory();
		void refreshAnalytics();
		void refreshPermissions();
		return () => {
			wsRef.current?.close();
			if (reconnectTimerRef.current) {
				window.clearTimeout(reconnectTimerRef.current);
			}
		};
	}, [connectWebSocket, documentDetails, refreshAnalytics, refreshHistory, refreshPermissions]);

	useEffect(() => {
		editorRef.current?.dispatch({ effects: cursorEffect.of(users) });
	}, [users]);

	return (
		<main className="shell">
			<header className="topbar">
				<div className="identity">
					<div className="mark">CN</div>
					<div>
						<h1>Collaborative Notebook</h1>
						<p>{documentDetails ? `${documentDetails.id} owned by ${documentDetails.ownerId}` : 'No document loaded'}</p>
					</div>
				</div>
				<div className="toolbar">
					<input aria-label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
					<button type="button" onClick={() => void ensureSession()}>
						Sign in
					</button>
					<button type="button" onClick={() => void createDocument()}>
						New
					</button>
					<button type="button" disabled={role !== 'owner'} onClick={() => void createShareLink()}>
						Share
					</button>
				</div>
			</header>

			<section className="statusbar" aria-live="polite">
				<div className={`status ${connectionState === 'default' ? '' : connectionState}`}>{connection}</div>
				<div>Latency: {p95Latency === null ? 'n/a' : `${p95Latency}ms p95`}</div>
				<div>Revision: {revision}</div>
				<div>Role: {role ?? 'none'}</div>
			</section>

			<section className="workspace">
				<aside className="side panel">
					<PanelHeader title="Collaborators" />
					<div className="list">
						{users.length === 0 ? (
							<p className="empty">No active collaborators.</p>
						) : (
							users.map((user) => (
								<div className="listItem" key={user.id}>
									<strong>{user.name}</strong>
									<span>{`${user.role}${user.pos === null ? '' : ` at ${user.pos}`}`}</span>
									<code>{user.id}</code>
								</div>
							))
						)}
					</div>

					<PanelHeader title="Analytics" actionLabel="Refresh" onAction={() => void refreshAnalytics()} />
					<dl className="metrics">
						<dt>Edits today</dt>
						<dd>{analytics?.edit_count ?? 0}</dd>
						<dt>Connections today</dt>
						<dd>{analytics?.connection_count ?? 0}</dd>
						<dt>Max active users</dt>
						<dd>{analytics?.max_active_users ?? 0}</dd>
						<dt>Bytes in</dt>
						<dd>{analytics?.bytes_in ?? 0}</dd>
						<dt>Bytes out</dt>
						<dd>{analytics?.bytes_out ?? 0}</dd>
					</dl>
				</aside>

				<section className="editorColumn">
					<div className="titleRow">
						<input aria-label="Document title" value={title} onChange={(event) => setTitle(event.target.value)} />
						<button type="button" disabled={!canEdit} onClick={() => void saveTitle()}>
							Save
						</button>
					</div>
					<div ref={editorHostRef} className="editor" />
				</section>

				<aside className="side panel">
					<PanelHeader title="History" actionLabel="Refresh" onAction={() => void refreshHistory()} />
					<div className="list">
						{history.length === 0 ? (
							<p className="empty">No edits yet.</p>
						) : (
							history.map((change) => (
								<div className="listItem" key={change.id}>
									<strong>Revision {change.id}</strong>
									<span>
										{change.user_id} at {new Date(change.timestamp).toLocaleString()}
									</span>
									<div className="historyActions">
										<button type="button" disabled={!canEdit} onClick={() => void revertChange(change.id, 'old')}>
											Revert old
										</button>
										<button type="button" disabled={!canEdit} onClick={() => void revertChange(change.id, 'new')}>
											Revert new
										</button>
									</div>
								</div>
							))
						)}
					</div>

					<PanelHeader title="Permissions" />
					<div className="permissionForm">
						<input aria-label="User ID" placeholder="User ID" value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)} />
						<select aria-label="Role" value={grantRole} onChange={(event) => setGrantRole(event.target.value as 'viewer' | 'editor')}>
							<option value="viewer">Viewer</option>
							<option value="editor">Editor</option>
						</select>
						<button type="button" disabled={role !== 'owner'} onClick={() => void grantPermission()}>
							Grant
						</button>
					</div>
					<div className="list">
						{role !== 'owner' ? (
							<p className="empty">Owner access required.</p>
						) : (
							permissions.map((permission) => (
								<div className="listItem" key={permission.user_id}>
									<strong>{permission.role}</strong>
									<code>{permission.user_id}</code>
								</div>
							))
						)}
					</div>
				</aside>
			</section>

			{toast ? <div className="toast">{toast}</div> : null}
		</main>
	);
}

function PanelHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
	return (
		<div className="sectionHeader">
			<h2>{title}</h2>
			{actionLabel ? (
				<button type="button" onClick={onAction}>
					{actionLabel}
				</button>
			) : null}
		</div>
	);
}

function throttle(fn: () => void, ms: number): () => void {
	let timer = 0;
	return () => {
		if (timer) {
			return;
		}
		timer = window.setTimeout(() => {
			timer = 0;
			fn();
		}, ms);
	};
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
