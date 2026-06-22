import { createSession, getSession, signShare, unauthorized, verifyShare } from './auth';
import type { AppEnv } from './env';
export { NotebookDocument } from './notebook';
import type { ApiResult } from './notebook';
import { isRole } from './messages';

type Route = {
	segments: string[];
	url: URL;
};

export default {
	async fetch(request, env): Promise<Response> {
		try {
			return await handleRequest(request, env);
		} catch (error) {
			console.error(JSON.stringify({ event: 'request_error', message: error instanceof Error ? error.message : String(error) }));
			return Response.json({ error: 'Internal server error' }, { status: 500 });
		}
	},
} satisfies ExportedHandler<AppEnv>;

async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
	const route = parseRoute(request);

	if (request.method === 'POST' && route.url.pathname === '/api/session') {
		return handleSession(request, env);
	}

	if (request.method === 'POST' && route.url.pathname === '/api/share/accept') {
		return handleAcceptShare(request, env);
	}

	if (route.segments[0] === 'api' && route.segments[1] === 'documents') {
		return handleDocumentApi(request, env, route);
	}

	if (request.method === 'GET' && route.segments[0] === 'edit' && route.segments[1]) {
		return handleWebSocket(request, env, route.segments[1]);
	}

	return new Response('Not found', { status: 404 });
}

async function handleSession(request: Request, env: AppEnv): Promise<Response> {
	const body = await readJson<{ name?: string }>(request);
	const currentSession = await getSession(request, env);
	const { session, cookie } = await createSession(body.name ?? currentSession?.name ?? 'Notebook User', env, currentSession?.userId);
	return Response.json(
		{ userId: session.userId, name: session.name, expiresAt: session.exp },
		{ headers: { 'Set-Cookie': cookie } },
	);
}

async function handleDocumentApi(request: Request, env: AppEnv, route: Route): Promise<Response> {
	const session = await getSession(request, env);
	if (!session) {
		return unauthorized();
	}

	if (request.method === 'POST' && route.segments.length === 2) {
		const body = await readJson<{ title?: string }>(request);
		const docId = crypto.randomUUID();
		const stub = env.NOTEBOOK.getByName(docId);
		const result = await stub.createDocument({
			docId,
			title: body.title ?? 'Untitled notebook',
			ownerId: session.userId,
		});
		return Response.json(result, { status: 201 });
	}

	const docId = route.segments[2];
	if (!docId) {
		return new Response('Not found', { status: 404 });
	}
	const stub = env.NOTEBOOK.getByName(docId);

	if (request.method === 'GET' && route.segments.length === 3) {
		return toResponse(await stub.getDocument({ docId, userId: session.userId }));
	}

	if (request.method === 'PATCH' && route.segments.length === 3) {
		const body = await readJson<{ title?: string }>(request);
		if (typeof body.title !== 'string') {
			return Response.json({ error: 'title is required.' }, { status: 400 });
		}
		return toResponse(await stub.updateTitle({ docId, userId: session.userId, title: body.title }));
	}

	if (request.method === 'GET' && route.segments[3] === 'history') {
		return toResponse(await stub.getHistory({ docId, userId: session.userId }));
	}

	if (request.method === 'POST' && route.segments[3] === 'revert') {
		const body = await readJson<{ changeId?: number; target?: 'old' | 'new' }>(request);
		if (typeof body.changeId !== 'number' || (body.target !== 'old' && body.target !== 'new')) {
			return Response.json({ error: 'changeId and target are required.' }, { status: 400 });
		}
		return toResponse(await stub.revert({ docId, userId: session.userId, changeId: body.changeId, target: body.target }));
	}

	if (request.method === 'GET' && route.segments[3] === 'permissions') {
		return toResponse(await stub.listPermissions({ docId, userId: session.userId }));
	}

	if (request.method === 'PUT' && route.segments[3] === 'permissions' && route.segments[4]) {
		const body = await readJson<{ role?: string }>(request);
		if (body.role !== 'editor' && body.role !== 'viewer') {
			return Response.json({ error: 'role must be editor or viewer.' }, { status: 400 });
		}
		return toResponse(
			await stub.grantPermission({
				docId,
				actorId: session.userId,
				targetUserId: decodeURIComponent(route.segments[4]),
				role: body.role,
			}),
		);
	}

	if (request.method === 'POST' && route.segments[3] === 'share') {
		const body = await readJson<{ role?: string; ttlSeconds?: number }>(request);
		if (body.role !== 'editor' && body.role !== 'viewer') {
			return Response.json({ error: 'role must be editor or viewer.' }, { status: 400 });
		}
		const callerRole = await stub.getRoleForUser({ docId, userId: session.userId });
		if (callerRole !== 'owner') {
			return Response.json({ error: 'Only owners can create share links.' }, { status: 403 });
		}
		const exp = Math.floor(Date.now() / 1000) + Math.min(Math.max(body.ttlSeconds ?? 86400, 300), 60 * 60 * 24 * 30);
		const token = await signShare({ docId, role: body.role, exp }, env);
		return Response.json({ token, url: `/?share=${encodeURIComponent(token)}`, role: body.role, expiresAt: exp });
	}

	if (request.method === 'GET' && route.segments[3] === 'analytics') {
		return toResponse(await stub.getAnalytics({ docId, userId: session.userId }));
	}

	return new Response('Not found', { status: 404 });
}

async function handleAcceptShare(request: Request, env: AppEnv): Promise<Response> {
	const session = await getSession(request, env);
	if (!session) {
		return unauthorized();
	}
	const body = await readJson<{ token?: string }>(request);
	if (typeof body.token !== 'string') {
		return Response.json({ error: 'token is required.' }, { status: 400 });
	}
	const share = await verifyShare(body.token, env);
	if (!share || !isRole(share.role)) {
		return Response.json({ error: 'Share link is invalid or expired.' }, { status: 400 });
	}
	const stub = env.NOTEBOOK.getByName(share.docId);
	return toResponse(
		await stub.grantPermission({
			docId: share.docId,
			actorId: session.userId,
			targetUserId: session.userId,
			role: share.role,
			systemGrant: true,
		}),
	);
}

async function handleWebSocket(request: Request, env: AppEnv, docId: string): Promise<Response> {
	if (request.headers.get('Upgrade') !== 'websocket') {
		return new Response('Expected WebSocket upgrade', { status: 426 });
	}

	const session = await getSession(request, env);
	if (!session) {
		return new Response('Unauthorized', { status: 401 });
	}

	const upstream = new URL(request.url);
	upstream.searchParams.set('userId', session.userId);
	upstream.searchParams.set('name', session.name);

	const stub = env.NOTEBOOK.getByName(docId);
	return stub.fetch(new Request(upstream, request));
}

function parseRoute(request: Request): Route {
	const url = new URL(request.url);
	return {
		url,
		segments: url.pathname.split('/').filter(Boolean).map(decodeURIComponent),
	};
}

async function readJson<T>(request: Request): Promise<T> {
	if (!request.body) {
		return {} as T;
	}
	if (!request.headers.get('Content-Type')?.includes('application/json')) {
		return {} as T;
	}
	return (await request.json()) as T;
}

function toResponse(result: ApiResult): Response {
	return Response.json(result.body, { status: result.status });
}
