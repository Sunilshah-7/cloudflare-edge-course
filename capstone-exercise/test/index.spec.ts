import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bytesToBase64 } from '../src/encoding';

type SessionResponse = {
	userId: string;
	name: string;
	expiresAt: number;
};

type CreateDocumentResponse = {
	id: string;
	title: string;
	ownerId: string;
	editUrl: string;
	viewUrl: string;
};

type ActiveUser = {
	id: string;
	name: string;
	role: string;
	pos: number | null;
	selection: { anchor: number; head: number } | null;
};

describe('collaborative notebook worker', () => {
	it('returns 404 for unknown routes', async () => {
		const response = await SELF.fetch('http://example.com/unknown');

		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe('Not found');
	});

	it('creates a session and document, then returns document metadata', async () => {
		const { cookie, session } = await createSession('Ada');
		const created = await createDocument(cookie, 'Design notes');

		expect(created.title).toBe('Design notes');
		expect(created.ownerId).toBe(session.userId);
		expect(created.editUrl).toBe(`/documents/${created.id}`);

		const response = await SELF.fetch(`http://example.com/api/documents/${created.id}`, {
			headers: { Cookie: cookie },
		});
		const body = (await response.json()) as {
			id: string;
			title: string;
			ownerId: string;
			content: string;
			role: string;
			revision: number;
		};

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			id: created.id,
			title: 'Design notes',
			ownerId: session.userId,
			content: '',
			role: 'owner',
			revision: 0,
		});
	});

	it('preserves the same user id when refreshing a session', async () => {
		const { cookie, session } = await createSession('Ada');
		const created = await createDocument(cookie, 'Persistent notes');

		const refreshResponse = await SELF.fetch('http://example.com/api/session', {
			method: 'POST',
			headers: { Cookie: cookie, 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Ada Lovelace' }),
		});
		expect(refreshResponse.status).toBe(200);
		const refreshed = (await refreshResponse.json()) as SessionResponse;
		const refreshedCookie = refreshResponse.headers.get('Set-Cookie')?.split(';')[0] ?? '';

		expect(refreshed.userId).toBe(session.userId);
		expect(refreshed.name).toBe('Ada Lovelace');

		const documentResponse = await SELF.fetch(`http://example.com/api/documents/${created.id}`, {
			headers: { Cookie: refreshedCookie },
		});
		expect(documentResponse.status).toBe(200);
		const document = (await documentResponse.json()) as { id: string; role: string };
		expect(document).toMatchObject({ id: created.id, role: 'owner' });
	});

	it('grants viewer access through a signed share link', async () => {
		const owner = await createSession('Owner');
		const viewer = await createSession('Viewer');
		const created = await createDocument(owner.cookie, 'Shared plan');

		const shareResponse = await SELF.fetch(`http://example.com/api/documents/${created.id}/share`, {
			method: 'POST',
			headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
			body: JSON.stringify({ role: 'viewer' }),
		});
		expect(shareResponse.status).toBe(200);
		const share = (await shareResponse.json()) as { token: string; role: string };
		expect(share.role).toBe('viewer');

		const acceptResponse = await SELF.fetch('http://example.com/api/share/accept', {
			method: 'POST',
			headers: { Cookie: viewer.cookie, 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: share.token }),
		});
		expect(acceptResponse.status).toBe(200);
		const accepted = (await acceptResponse.json()) as { docId: string; role: string };
		expect(accepted).toMatchObject({ docId: created.id, role: 'viewer' });

		const documentResponse = await SELF.fetch(`http://example.com/api/documents/${created.id}`, {
			headers: { Cookie: viewer.cookie },
		});
		const document = (await documentResponse.json()) as { role: string };
		expect(document.role).toBe('viewer');
	});

	it('synchronizes a legacy edit over WebSocket and stores history', async () => {
		const { cookie } = await createSession('Editor');
		const created = await createDocument(cookie, 'Socket doc');
		const socket = await openSocket(cookie, created.id);

		const init = await waitForMessage<{ type: string; content: string; revision: number }>(socket);
		expect(init).toMatchObject({ type: 'init', content: '', revision: 0 });

		socket.send(JSON.stringify({ type: 'edit', content: 'Hello from the edge', clientSeq: 1, clientTs: Date.now() }));
		const update = await waitForMessage<{ type: string; content: string; revision: number }>(socket, 'update');
		expect(update).toMatchObject({ type: 'update', content: 'Hello from the edge', revision: 1 });

		const historyResponse = await SELF.fetch(`http://example.com/api/documents/${created.id}/history`, {
			headers: { Cookie: cookie },
		});
		const history = (await historyResponse.json()) as { changes: Array<{ old_content: string; new_content: string }> };
		expect(history.changes[0]).toMatchObject({ old_content: '', new_content: 'Hello from the edge' });

		socket.close();
	});

	it('broadcasts document edits from client A to client B', async () => {
		const clientA = await createSession('Client A');
		const clientB = await createSession('Client B');
		const created = await createDocument(clientA.cookie, 'Two client edit');
		await grantPermission(clientA.cookie, created.id, clientB.session.userId, 'editor');

		const socketA = await openSocket(clientA.cookie, created.id);
		await waitForMessage(socketA, 'init');
		const socketB = await openSocket(clientB.cookie, created.id);
		await waitForMessage(socketB, 'init');

		const clientBUpdatePromise = waitForMessage<{ type: string; content: string; from: string; revision: number }>(
			socketB,
			'update',
		);
		socketA.send(JSON.stringify({ type: 'edit', content: 'Client A wrote this', clientSeq: 1, clientTs: Date.now() }));

		const update = await clientBUpdatePromise;
		expect(update).toMatchObject({
			type: 'update',
			content: 'Client A wrote this',
			from: clientA.session.userId,
			revision: 1,
		});

		socketA.close();
		socketB.close();
	});

	it('merges simultaneous Yjs edits from two WebSocket clients', async () => {
		const clientA = await createSession('Concurrent A');
		const clientB = await createSession('Concurrent B');
		const created = await createDocument(clientA.cookie, 'Concurrent edit');
		await grantPermission(clientA.cookie, created.id, clientB.session.userId, 'editor');

		const socketA = await openSocket(clientA.cookie, created.id);
		await waitForMessage(socketA, 'init');
		const socketB = await openSocket(clientB.cookie, created.id);
		await waitForMessage(socketB, 'init');

		const ydocA = new Y.Doc();
		ydocA.getText('body').insert(0, 'Alpha');
		const ydocB = new Y.Doc();
		ydocB.getText('body').insert(0, 'Beta');

		const mergedUpdateForA = waitForMergedContent(socketA, 'Alpha', 'Beta');
		const mergedUpdateForB = waitForMergedContent(socketB, 'Alpha', 'Beta');

		socketA.send(
			JSON.stringify({
				type: 'edit',
				update: bytesToBase64(Y.encodeStateAsUpdate(ydocA)),
				clientSeq: 1,
				clientTs: Date.now(),
			}),
		);
		socketB.send(
			JSON.stringify({
				type: 'edit',
				update: bytesToBase64(Y.encodeStateAsUpdate(ydocB)),
				clientSeq: 1,
				clientTs: Date.now(),
			}),
		);

		const [updateA, updateB] = await Promise.all([mergedUpdateForA, mergedUpdateForB]);
		expect(updateA.revision).toBe(2);
		expect(updateB.revision).toBe(2);
		expect(updateA.content).toBe(updateB.content);
		expect(updateA.content).toContain('Alpha');
		expect(updateA.content).toContain('Beta');

		const documentResponse = await SELF.fetch(`http://example.com/api/documents/${created.id}`, {
			headers: { Cookie: clientA.cookie },
		});
		expect(documentResponse.status).toBe(200);
		const document = (await documentResponse.json()) as { content: string; revision: number };
		expect(document.revision).toBe(2);
		expect(document.content).toBe(updateA.content);

		socketA.close();
		socketB.close();
	});

	it('sends the latest document title over WebSocket init', async () => {
		const { cookie } = await createSession('Renamer');
		const created = await createDocument(cookie, 'Original title');
		const socket = await openSocket(cookie, created.id);

		const init = await waitForMessage<{ type: string; title: string }>(socket);
		expect(init).toMatchObject({ type: 'init', title: 'Original title' });

		const renameResponse = await SELF.fetch(`http://example.com/api/documents/${created.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie, 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'Live title' }),
		});
		expect(renameResponse.status).toBe(200);

		socket.close();

		const nextSocket = await openSocket(cookie, created.id);
		const nextInit = await waitForMessage<{ type: string; title: string }>(nextSocket);
		expect(nextInit).toMatchObject({ type: 'init', title: 'Live title' });

		nextSocket.close();
	});

	it('tracks active users when collaborators connect', async () => {
		const owner = await createSession('Owner');
		const editor = await createSession('Editor');
		const created = await createDocument(owner.cookie, 'Connect states');
		await grantPermission(owner.cookie, created.id, editor.session.userId, 'editor');

		const ownerSocket = await openSocket(owner.cookie, created.id);
		const ownerInit = await waitForMessage<{ type: string; users: ActiveUser[] }>(ownerSocket);
		expect(ownerInit).toMatchObject({ type: 'init' });
		expect(ownerInit.users.map((user) => user.id)).toContain(owner.session.userId);

		const ownerUsersPromise = waitForMessageWhere<{ type: string; active: ActiveUser[] }>(
			ownerSocket,
			(message) =>
				message.type === 'users' &&
				message.active.some((user) => user.id === owner.session.userId) &&
				message.active.some((user) => user.id === editor.session.userId),
			'users with owner and editor',
		);
		const editorSocket = await openSocket(editor.cookie, created.id);
		const editorInit = await waitForMessage<{ type: string; users: ActiveUser[] }>(editorSocket);
		expect(editorInit).toMatchObject({ type: 'init' });
		expect(editorInit.users.map((user) => user.id)).toEqual(
			expect.arrayContaining([owner.session.userId, editor.session.userId]),
		);

		const usersMessage = await ownerUsersPromise;
		expect(usersMessage.active).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: owner.session.userId, role: 'owner' }),
				expect.objectContaining({ id: editor.session.userId, role: 'editor' }),
			]),
		);

		ownerSocket.close();
		editorSocket.close();
	});

	it('broadcasts cursor state to other connected clients', async () => {
		const owner = await createSession('Cursor Owner');
		const editor = await createSession('Cursor Editor');
		const created = await createDocument(owner.cookie, 'Cursor states');
		await grantPermission(owner.cookie, created.id, editor.session.userId, 'editor');

		const ownerSocket = await openSocket(owner.cookie, created.id);
		await waitForMessage(ownerSocket, 'init');
		const editorSocket = await openSocket(editor.cookie, created.id);
		await waitForMessage(editorSocket, 'init');

		editorSocket.send(JSON.stringify({ type: 'cursor', pos: 42, selection: { anchor: 40, head: 42 } }));

		const cursor = await waitForMessage<{ type: string; userId: string; pos: number; selection: { anchor: number; head: number } | null }>(
			ownerSocket,
			'cursor',
		);
		expect(cursor).toMatchObject({
			type: 'cursor',
			userId: editor.session.userId,
			pos: 42,
			selection: { anchor: 40, head: 42 },
		});

		const users = await waitForMessageWhere<{ type: string; active: ActiveUser[] }>(
			ownerSocket,
			(message) =>
				message.type === 'users' &&
				message.active.some(
					(user) => user.id === editor.session.userId && user.pos === 42 && user.selection?.anchor === 40 && user.selection.head === 42,
				),
			'users with editor cursor',
		);
		expect(users.active).toContainEqual(
			expect.objectContaining({
				id: editor.session.userId,
				pos: 42,
				selection: { anchor: 40, head: 42 },
			}),
		);

		ownerSocket.close();
		editorSocket.close();
	});

	it('removes disconnected users from the active users list', async () => {
		const owner = await createSession('Disconnect Owner');
		const viewer = await createSession('Disconnect Viewer');
		const created = await createDocument(owner.cookie, 'Disconnect states');
		await grantPermission(owner.cookie, created.id, viewer.session.userId, 'viewer');

		const ownerSocket = await openSocket(owner.cookie, created.id);
		await waitForMessage(ownerSocket, 'init');
		const viewerConnectedPromise = waitForMessageWhere<{ type: string; active: ActiveUser[] }>(
			ownerSocket,
			(message) => message.type === 'users' && message.active.some((user) => user.id === viewer.session.userId),
			'users with viewer connected',
		);
		const viewerSocket = await openSocket(viewer.cookie, created.id);
		await waitForMessage(viewerSocket, 'init');
		await viewerConnectedPromise;

		const viewerDisconnectedPromise = waitForMessageWhere<{ type: string; active: ActiveUser[] }>(
			ownerSocket,
			(message) => message.type === 'users' && !message.active.some((user) => user.id === viewer.session.userId),
			'users without disconnected viewer',
		);
		viewerSocket.close();

		const usersAfterClose = await viewerDisconnectedPromise;
		expect(usersAfterClose.active.map((user) => user.id)).toContain(owner.session.userId);
		expect(usersAfterClose.active.map((user) => user.id)).not.toContain(viewer.session.userId);

		ownerSocket.close();
	});
});

describe('Yjs conflict behavior', () => {
	it('converges when concurrent updates are applied in different orders', () => {
		const left = new Y.Doc();
		const right = new Y.Doc();
		left.getText('body').insert(0, 'A');
		right.getText('body').insert(0, 'B');

		const leftUpdate = Y.encodeStateAsUpdate(left);
		const rightUpdate = Y.encodeStateAsUpdate(right);

		const mergedA = new Y.Doc();
		const mergedB = new Y.Doc();
		Y.applyUpdate(mergedA, leftUpdate);
		Y.applyUpdate(mergedA, rightUpdate);
		Y.applyUpdate(mergedB, rightUpdate);
		Y.applyUpdate(mergedB, leftUpdate);

		expect(mergedA.getText('body').toString()).toBe(mergedB.getText('body').toString());
		expect(bytesToBase64(Y.encodeStateAsUpdate(mergedA))).toBeTypeOf('string');
	});
});

async function createSession(name: string): Promise<{ cookie: string; session: SessionResponse }> {
	const response = await SELF.fetch('http://example.com/api/session', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	});
	expect(response.status).toBe(200);
	const setCookie = response.headers.get('Set-Cookie');
	expect(setCookie).toBeTruthy();
	return {
		cookie: setCookie?.split(';')[0] ?? '',
		session: (await response.json()) as SessionResponse,
	};
}

async function createDocument(cookie: string, title: string): Promise<CreateDocumentResponse> {
	const response = await SELF.fetch('http://example.com/api/documents', {
		method: 'POST',
		headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		body: JSON.stringify({ title }),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as CreateDocumentResponse;
}

async function grantPermission(cookie: string, docId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
	const response = await SELF.fetch(`http://example.com/api/documents/${docId}/permissions/${encodeURIComponent(userId)}`, {
		method: 'PUT',
		headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		body: JSON.stringify({ role }),
	});
	expect(response.status).toBe(200);
}

async function openSocket(cookie: string, docId: string): Promise<WebSocket> {
	const response = await SELF.fetch(`http://example.com/edit/${docId}`, {
		headers: {
			Cookie: cookie,
			Upgrade: 'websocket',
		},
	});
	expect(response.status).toBe(101);
	const socket = response.webSocket;
	expect(socket).toBeTruthy();
	socket?.accept();
	return socket as WebSocket;
}

async function waitForMessage<T extends { type: string }>(socket: WebSocket, type?: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.removeEventListener('message', onMessage);
			reject(new Error(`Timed out waiting for ${type ?? 'message'}`));
		}, 1500);

		function onMessage(event: MessageEvent): void {
			const parsed = JSON.parse(String(event.data)) as T;
			if (type && parsed.type !== type) {
				return;
			}
			clearTimeout(timeout);
			socket.removeEventListener('message', onMessage);
			resolve(parsed);
		}

		socket.addEventListener('message', onMessage);
	});
}

async function waitForMessageWhere<T extends { type: string }>(
	socket: WebSocket,
	matches: (message: T) => boolean,
	description: string,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.removeEventListener('message', onMessage);
			reject(new Error(`Timed out waiting for ${description}`));
		}, 1500);

		function onMessage(event: MessageEvent): void {
			const parsed = JSON.parse(String(event.data)) as T;
			if (!matches(parsed)) {
				return;
			}
			clearTimeout(timeout);
			socket.removeEventListener('message', onMessage);
			resolve(parsed);
		}

		socket.addEventListener('message', onMessage);
	});
}

async function waitForMergedContent(socket: WebSocket, left: string, right: string): Promise<{ type: string; content: string; revision: number }> {
	return waitForMessageWhere<{ type: string; content: string; revision: number }>(
		socket,
		(message) => message.type === 'update' && message.revision === 2 && message.content.includes(left) && message.content.includes(right),
		`merged content containing ${left} and ${right}`,
	);
}
