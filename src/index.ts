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

type Middleware = (request: Request, env: Env) => Promise<Request | Response>;

interface JWKWithKid extends JsonWebKey {
	kid?: string;
}

interface JWKS {
	keys: JWKWithKid[];
}

interface JWTPayload {
	sub?: string;
	scope?: string;
	exp?: number;
	nbf?: number;
	iat?: number;
	[key: string]: unknown;
}

const jwksCache = new Map<string, { jwks: JWKS; expiresAt: number }>();

function decodeBase64Url(value: string): ArrayBuffer {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

function decodeBase64UrlJson<T>(value: string): T {
	const decoder = new TextDecoder();
	return JSON.parse(decoder.decode(decodeBase64Url(value))) as T;
}

function getMaxAge(cacheControl: string | null): number {
	const maxAge = cacheControl?.match(/(?:^|,\s*)max-age=(\d+)/i)?.[1];
	return maxAge ? Number(maxAge) : 300;
}

async function fetchJWKS(jwksUrl: string): Promise<JWKS> {
	const cached = jwksCache.get(jwksUrl);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.jwks;
	}

	const response = await fetch(jwksUrl, {
		headers: { Accept: 'application/json' },
	});

	if (!response.ok) {
		throw new Error(`JWKS fetch failed: ${response.status}`);
	}

	const jwks = (await response.json()) as JWKS;
	jwksCache.set(jwksUrl, {
		jwks,
		expiresAt: Date.now() + getMaxAge(response.headers.get('Cache-Control')) * 1000,
	});
	return jwks;
}

async function verifyJWT(token: string, jwksUrl: string): Promise<JWTPayload> {
	const parts = token.split('.');
	if (parts.length !== 3) {
		throw new Error('Invalid JWT format');
	}

	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(encodedHeader);
	const payload = decodeBase64UrlJson<JWTPayload>(encodedPayload);

	if (header.alg !== 'RS256') {
		throw new Error('Unsupported JWT algorithm');
	}

	if (!header.kid) {
		throw new Error('JWT header missing kid');
	}

	const jwks = await fetchJWKS(jwksUrl);
	const jwk = jwks.keys.find((key) => key.kid === header.kid);
	if (!jwk) {
		throw new Error('No matching JWKS key');
	}

	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{
			name: 'RSASSA-PKCS1-v1_5',
			hash: 'SHA-256',
		},
		false,
		['verify']
	);

	const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
	const signature = decodeBase64Url(encodedSignature);
	const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
	if (!verified) {
		throw new Error('Invalid JWT signature');
	}

	const now = Math.floor(Date.now() / 1000);
	if (payload.exp !== undefined && payload.exp <= now) {
		throw new Error('JWT expired');
	}
	if (payload.nbf !== undefined && payload.nbf > now) {
		throw new Error('JWT not active');
	}
	if (!payload.sub) {
		throw new Error('JWT missing sub');
	}

	return payload;
}

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
	const auth = request.headers.get('Authorization');
	const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) {
		return new Response('Unauthorized', { status: 401 });
	}

	if (!env.JWKS_URL) {
		return new Response('Auth configuration missing', { status: 500 });
	}

	try {
		const user = await verifyJWT(token, env.JWKS_URL);
		const headers = new Headers(request.headers);
		headers.set('X-User-ID', user.sub!);
		if (typeof user.scope === 'string') {
			headers.set('X-User-Scope', user.scope);
		}

		return new Request(request, { headers });
	} catch (error) {
		console.warn('JWT verification failed:', error);
		return new Response('Unauthorized', { status: 401 });
	}
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

function isDebugEnabled(debug: Env['DEBUG']): boolean {
	return debug === true || debug === 'true';
}

function appendPath(url: string, path: string): string {
	return `${url.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function readUpstreamBody(response: Response): Promise<unknown> {
	const contentType = response.headers.get('Content-Type') || '';
	if (contentType.includes('application/json')) {
		return response.json();
	}

	return response.text();
}

async function fetchConfiguredAPIs(request: Request, env: Env): Promise<Response> {
	const { API_KEY: apiKey, API_ENDPOINT: endpoint } = env;

	if (!apiKey || !endpoint) {
		return new Response('API configuration missing', { status: 500 });
	}

	const urls = [endpoint, appendPath(endpoint, 'posts'), appendPath(endpoint, 'comments')];

	if (isDebugEnabled(env.DEBUG)) {
		console.log(`Calling ${urls.join(', ')}`);
	}

	const headers = new Headers(request.headers);
	headers.set('Authorization', `Bearer ${apiKey}`);

	const [user, posts, comments] = await Promise.all(
		urls.map((url) =>
			fetch(url, {
				headers,
			})
		)
	);

	if (!user.ok || !posts.ok || !comments.ok) {
		return new Response('Upstream request failed', { status: 502 });
	}

	const [userBody, postsBody, commentsBody] = await Promise.all([
		readUpstreamBody(user),
		readUpstreamBody(posts),
		readUpstreamBody(comments),
	]);

	return Response.json({
		user: userBody,
		posts: postsBody,
		comments: commentsBody,
	});
}

export async function handler(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	// Define middleware stack
	const middlewares: Middleware[] = [withCORS, withAuth];

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

	// Proceed with request
	return fetchConfiguredAPIs(currentRequest, env);
}

export default {
	fetch: handler,
} satisfies ExportedHandler<Env>;
