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
		// Example 1: Simple boolean flag to enable/disable a new feature
		const useNewRouting = await isFeatureFlagSimple(
			env.FEATURE_FLAGS,
			'new-routing-algorithm',
			request,
			false // Default to false (use existing logic)
		);

		// Example 2: Flag with rollout percentage and targeting
		const showNewUI = await isFeatureFlagEnabled(
			env.FEATURE_FLAGS,
			'new-user-interface',
			request,
			{
				defaultValue: false,
				rolloutPercentage: 25, // Gradual rollout to 25% of users
				targeting: {
					countries: ['US', 'CA', 'GB', 'DE'], // Only in these countries
					deviceTypes: ['mobile'] // Only for mobile users initially
				},
				cacheTtlSeconds: 300 // Cache for 5 minutes (more frequent updates for UI changes)
			}
		);

		// 1. Read the User-Agent header
		const ua = request.headers.get('User-Agent') || '';
		const isMobile = /mobile|android/i.test(ua);

		// 2. Get Cloudflare colo (data center location)
		const colo = request.cf?.colo || 'unknown';

		// 3. Route traffic - controlled by feature flag
		let originUrl;
		if (useNewRouting) {
			// New routing logic: route based on geography instead of just device type
			if (colo === 'LHR' || colo === 'CDG') {
				// European traffic goes to EU origin
				originUrl = 'https://eu-origin.example.com';
			} else if (colo === 'SFO' || colo === 'LAX') {
				// West US traffic goes to US-West origin
				originUrl = 'https://us-west.example.com';
			} else {
				// Default to US-East for everywhere else
				originUrl = 'https://us-east.example.com';
			}
		} else {
			// Existing logic: route based on device type
			originUrl = isMobile ? 'https://mobile.example.com' : 'https://www.example.com';
		}

		const url = new URL(request.url);
		url.host = originUrl.split('//')[1];

		// 4. Create new request with custom headers
		const newRequest = new Request(url, request);
		newRequest.headers.set('X-Forwarded-By', 'edge-worker');
		newRequest.headers.set('X-Is-Mobile', isMobile ? 'true' : 'false');
		newRequest.headers.set('X-Edge-Location', colo); // Add custom header with colo

		// Example 3: Conditionally add headers based on feature flags
		if (showNewUI) {
			newRequest.headers.set('X-New-UI-Enabled', 'true');
			newRequest.headers.set('X-UI-Version', 'v2');
		} else {
			newRequest.headers.set('X-New-UI-Enabled', 'false');
		}

		try {
			const response = await fetch(newRequest);
			response.headers.set('X-Edge-Cached', 'true');
			response.headers.set('X-Edge-Location', colo);

			// Add feature flag info to response headers for debugging
			response.headers.set('X-Flag-New-Routing', useNewRouting ? 'true' : 'false');
			response.headers.set('X-Flag-New-UI', showNewUI ? 'true' : 'false');

			return response;
		} catch (error) {
			// Return a helpful error message instead of crashing
			return new Response(
				`Origin fetch failed: ${error.message}\n` +
				`Is mobile: ${isMobile}\n` +
				`Cloudflare colo: ${colo}\n` +
				`Trying to reach: ${originUrl}\n` +
				`New routing enabled: ${useNewRouting}\n` +
				`New UI enabled: ${showNewUI}\n\n` +
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