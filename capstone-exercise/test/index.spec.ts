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
