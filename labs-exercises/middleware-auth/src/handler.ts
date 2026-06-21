import type { AuthenticatedRequest } from './middleware';

export async function handleRequest(
	request: AuthenticatedRequest,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	void env;
	void ctx;

	const url = new URL(request.url);

	if (url.pathname === '/health') {
		return new Response(JSON.stringify({ ok: true }));
	}

	if (url.pathname === '/me') {
		return new Response(
			JSON.stringify({
				user: request.user,
				timestamp: new Date().toISOString(),
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	if (url.pathname === '/api/protected') {
		const userId = request.user?.sub;

		return new Response(
			JSON.stringify({
				message: `Hello ${userId}!`,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	return new Response('Not found', { status: 404 });
}
