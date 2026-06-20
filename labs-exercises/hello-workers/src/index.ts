/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const WORKER_NAME = 'hello-workers';
const UNKNOWN_VALUE = 'unknown';

function getClientIp(request: Request): string {
	return (
		request.headers.get('CF-Connecting-IP') ||
		request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
		UNKNOWN_VALUE
	);
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return Response.json(body, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...init.headers,
		},
	});
}

function logRequest(request: Request): void {
	const url = new URL(request.url);
	console.log(
		JSON.stringify({
			event: 'request',
			method: request.method,
			pathname: url.pathname,
			colo: request.cf?.colo || UNKNOWN_VALUE,
			clientIp: getClientIp(request),
		}),
	);
}

async function routeRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	switch (url.pathname) {
		case '/message':
			return new Response('Hello from the edge!');
		case '/random':
			return new Response(crypto.randomUUID());
		case '/stats':
			return jsonResponse({
				worker: WORKER_NAME,
				colo: request.cf?.colo || UNKNOWN_VALUE,
				clientIp: getClientIp(request),
			});
		case '/api/info':
			return jsonResponse({
				method: request.method,
				url: request.url,
				cf: request.cf,
			});
		default:
			return new Response('Not Found', { status: 404 });
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		logRequest(request);

		try {
			return await routeRequest(request);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: 'error',
					message: error instanceof Error ? error.message : 'Unknown error',
				}),
			);

			return jsonResponse(
				{
					error: 'Internal Server Error',
					message: 'Something went wrong while handling this request.',
				},
				{ status: 500 },
			);
		}
	},
} satisfies ExportedHandler<Env>;
