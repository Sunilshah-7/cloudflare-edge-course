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

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// 1. Read the User-Agent header
		const ua = request.headers.get('User-Agent') || '';
		const isMobile = /mobile|android/i.test(ua);
	
		// 2. Get Cloudflare colo (data center location)
		const colo = request.cf?.colo || 'unknown';

		// 3. Route mobile traffic to different origin
		const originUrl = isMobile ? 'https://mobile.example.com' : 'https:www.example.com';
		const url = new URL(request.url);
		url.host = originUrl.split('//')[1];

		// 4. Create new request with custom headers
		const newRequest = new Request(url, request);
		newRequest.headers.set('X-Forwarded-By', 'edge-worker');
		newRequest.headers.set('X-Is-Mobile', isMobile ? 'true' : 'false');
		newRequest.headers.set('X-Edge-Location', colo); // Add custom header with colo
	
		 try {
                        const response = await fetch(newRequest);
                        response.headers.set('X-Edge-Cached', 'true');
                        response.headers.set('X-Edge-Location', colo);
                        return response;
                } catch (error) {
                        // Return a helpful error message instead of crashing
                        return new Response(
                                `Origin fetch failed: ${error.message}\n` +
                                `Is mobile: ${isMobile}\n` +
                                `Cloudflare colo: ${colo}\n` +
                                `Trying to reach: ${originUrl}\n\n` +
                                `Note: In local development, external domains like example.com\n` +
                                `may not be accessible. This is expected behavior.\n` +
                                `For production, replace with your actual origin URLs.`,
                                {
                                        status: 502,
                                        headers: { 'Content-Type': 'text/plain' }
                                }
                        );
                }

	},
} satisfies ExportedHandler<Env>;
