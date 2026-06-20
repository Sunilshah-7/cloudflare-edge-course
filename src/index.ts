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
export { Counter } from './counter';
export { RateLimiter } from './rateLimiter';

type Middleware = (request: Request, env: Env) => Promise<Request | Response>;

const ORIGIN_TIMEOUT_MS = 5000;
const RATE_LIMIT_DEFAULT_LIMIT = 100;
const RATE_LIMIT_DEFAULT_WINDOW_SECONDS = 60;

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

	const userId = request.headers.get('X-User-ID') || request.headers.get('CF-Connecting-IP');
	if (!userId) return request;

	const result = await env.RATE_LIMITER.getByName(userId).check(
		userId,
		RATE_LIMIT_DEFAULT_LIMIT,
		RATE_LIMIT_DEFAULT_WINDOW_SECONDS
	);
	if (!result.allowed) {
		return new Response('Rate limited', {
			status: 429,
			headers: {
				'Retry-After': result.retryAfter.toString(),
				'X-RateLimit-Remaining': '0',
			},
		});
	}

	return request;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function getCacheKey(upstreamUrl: string, request: Request): Request {
	const cacheUrl = new URL('https://worker-cache.local/api-proxy');
	cacheUrl.searchParams.set('url', upstreamUrl);
	cacheUrl.searchParams.set('user', request.headers.get('X-User-ID') || 'anonymous');
	cacheUrl.searchParams.set('scope', request.headers.get('X-User-Scope') || '');

	return new Request(cacheUrl, { method: 'GET' });
}

async function fetchWithTimeout(url: string, headers: Headers): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort('Timeout'), ORIGIN_TIMEOUT_MS);

	try {
		return await fetch(url, {
			headers,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchResilientAPI(
	url: string,
	request: Request,
	headers: Headers,
	ctx: ExecutionContext
): Promise<Response> {
	const cacheKey = getCacheKey(url, request);
	const cache = caches.default;

	const cached = await cache.match(cacheKey);
	if (cached) {
		return cached;
	}

	try {
		const originResponse = await fetchWithTimeout(url, headers);

		if (originResponse.ok) {
			ctx.waitUntil(
				cache.put(cacheKey, originResponse.clone()).catch((error) => {
					console.warn('Cache put failed:', error);
				})
			);
			return originResponse;
		}

		console.error(`Origin fetch failed: ${originResponse.status}`);
	} catch (error) {
		console.error('Origin fetch failed:', error);
	}

	return new Response('Service unavailable (origin down)', { status: 503 });
}

async function fetchConfiguredAPIs(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
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
		urls.map((url) => fetchResilientAPI(url, request, headers, ctx))
	);

	if (!user.ok || !posts.ok || !comments.ok) {
		return new Response('Service unavailable (origin down)', { status: 503 });
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

async function handleCounterRequest(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith('/counter/')) {
		return null;
	}

	const userId = request.headers.get('X-User-ID');
	if (!userId) {
		return new Response('User context missing', { status: 500 });
	}

	const counter = env.COUNTER.getByName(userId);

	if (url.pathname === '/counter/get') {
		return new Response((await counter.get()).toString());
	}

	if (url.pathname === '/counter/increment') {
		return new Response((await counter.increment()).toString());
	}

	return new Response('Not found', { status: 404 });
}

async function handleRateLimitRequest(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== '/ratelimit/check') {
		return null;
	}

	const userId = url.searchParams.get('user_id') || request.headers.get('X-User-ID');
	if (!userId) {
		return new Response('User required', { status: 400 });
	}

	const limit = parsePositiveInteger(url.searchParams.get('limit'), RATE_LIMIT_DEFAULT_LIMIT);
	const windowSeconds = parsePositiveInteger(
		url.searchParams.get('window'),
		RATE_LIMIT_DEFAULT_WINDOW_SECONDS
	);
	const result = await env.RATE_LIMITER.getByName(userId).check(userId, limit, windowSeconds);
	const headers = {
		'X-RateLimit-Remaining': result.remaining.toString(),
		'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
	};

	if (!result.allowed) {
		return new Response('Rate limited', {
			status: 429,
			headers: {
				...headers,
				'Retry-After': result.retryAfter.toString(),
			},
		});
	}

	return new Response('OK', { status: 200, headers });
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

	const counterResponse = await handleCounterRequest(currentRequest, env);
	if (counterResponse) {
		return counterResponse;
	}

	const rateLimitResponse = await handleRateLimitRequest(currentRequest, env);
	if (rateLimitResponse) {
		return rateLimitResponse;
	}

	// Proceed with request
	return fetchConfiguredAPIs(currentRequest, env, ctx);
}

export default {
	fetch: handler,
} satisfies ExportedHandler<Env>;
