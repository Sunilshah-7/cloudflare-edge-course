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

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Skip rate limiting for non-targeted endpoints
		if(!request.url.includes('/api/risky')){
			return fetch(request);
		}

		// Get client IP from Cloudflare header
		const ip = request.headers.get('CF-Connecting-IP');
		if(!ip){
			// Handle missing IP
			return fetch(request);
		}

		const key = `ratelimit:${ip}`;
		const limit = 100;
		const window = 60;

		// Get current count for this IP
		const count = parseInt(await env.RATE_LIMIT.get(key) || '0');

		// Check if limit exceeded
		if (count >= limit){
			return new Response('Rate limited', {
				status: 429,
				headers: {'Retry-After': window.toString() }
			});
		}

		// Increment counter with expiration
		await env.RATE_LIMIT.put(key, (count + 1).toString(), {expirationTtl: window });

		// Proceed with request
		return fetch(request);
	}

} satisfies ExportedHandler<Env>;
