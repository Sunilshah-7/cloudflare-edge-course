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
import { isFeatureFlagEnabled, isFeatureFlagSimple } from './featureFlags';

async function withCORS(request: Request) {
	if (request.method === 'OPTIONS') {
		return new Response(null, {
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			},
		});
	}
	return request;
}

async function withAuth(request: Request, env: Env) {
	const token = request.headers.get('Authorization')?.replace('Bearer ', '');
	if (!token) {
		return new Response('Unauthorized', { status: 401 });
	}

	const user = { id: 'user123' };

	const newRequest = request.clone();
	newRequest.headers.set('X-User-Id', user.id);
	return newRequest;
}

async function withRateLimit(request: Request, env: Env) {
	if (!request.url.includes('/api/risky')) return request;

	const ip = request.headers.get('CF-Connecting-IP');
	if (!ip) return request;

	const key = `ratelimit:${ip}`;
	const limit = 100;
	const window = 60;

	const count = parseInt((await env.RATE_LIMIT.get(key)) || '0');
	if (count >= limit) {
		return new Response('Rate limited', {
			status: 429,
			headers: { 'Retry-After': window.toString() },
		});
	}

	await env.RATE_LIMIT.put(key, (count + 1).toString(), { expirationTtl: window });
	return request;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Define middleware stack
		const middlewares = [withCORS, withAuth];

		if (request.url.includes('/api/risky')) {
			middlewares.push(withRateLimit);
		}

		let currentRequest = request;
		for (const middleware of middlewares) {
			const result = await middleware(currentRequest, env);
			if (result instanceof Response) {
				return result;
			}
			currentRequest = result;
		}

		// Skip rate limiting for non-targeted endpoints
		if (!request.url.includes('/api/risky')) {
			return fetch(request);
		}

		// Proceed with request
		return fetch(currentRequest);
	},
} satisfies ExportedHandler<Env>;
