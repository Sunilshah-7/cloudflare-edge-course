import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

export type JwtClaims = JWTPayload & Record<string, unknown>;

export interface AuthenticatedRequest extends Request {
	user?: JwtClaims;
}

export type MiddlewareHandler<TEnv = Env> = (
	request: AuthenticatedRequest,
	env: TEnv,
	ctx: ExecutionContext,
) => Response | Promise<Response>;

export type NextFunction = () => Promise<Response>;

export type Middleware<TEnv = Env> = (
	request: AuthenticatedRequest,
	env: TEnv,
	ctx: ExecutionContext,
	next: NextFunction,
) => Response | Promise<Response>;

type RateLimitEntry = {
	count: number;
	resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitEntry>();

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function getClientIp(request: Request): string {
	return (
		request.headers.get('CF-Connecting-IP') ??
		request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
		'unknown'
	);
}

export function compose<TEnv = Env>(
	middlewares: Middleware<TEnv>[],
	handler: MiddlewareHandler<TEnv>,
): MiddlewareHandler<TEnv> {
	return async (request, env, ctx): Promise<Response> => {
		let index = -1;

		async function dispatch(i: number): Promise<Response> {
			if (i <= index) {
				throw new Error('next() called multiple times');
			}
			index = i;

			const mw = middlewares[i];
			if (!mw) {
				return handler(request, env, ctx);
			}

			return mw(request, env, ctx, () => dispatch(i + 1));
		}

		return dispatch(0);
	};
}

export const cors =
	(allowOrigin = '*'): Middleware =>
	async (request, env, ctx, next): Promise<Response> => {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': allowOrigin,
					'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE',
					'Access-Control-Allow-Headers': 'Content-Type,Authorization',
				},
			});
		}

		const response = await next();
		response.headers.set('Access-Control-Allow-Origin', allowOrigin);
		return response;
	};

export const logging: Middleware = async (request, env, ctx, next): Promise<Response> => {
	const start = Date.now();
	console.log(`-> ${request.method} ${new URL(request.url).pathname}`);

	const response = await next();
	const duration = Date.now() - start;
	console.log(`<- ${response.status} (${duration}ms)`);

	return response;
};

export const rateLimit =
	(limit = 10, windowMs = 60_000): Middleware =>
	async (request, env, ctx, next): Promise<Response> => {
		const now = Date.now();
		const ip = getClientIp(request);

		for (const [key, entry] of rateLimitBuckets) {
			if (entry.resetAt <= now) {
				rateLimitBuckets.delete(key);
			}
		}

		const current = rateLimitBuckets.get(ip);
		const entry =
			current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };

		entry.count += 1;
		rateLimitBuckets.set(ip, entry);

		if (entry.count > limit) {
			const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);

			return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': retryAfterSeconds.toString(),
				},
			});
		}

		return next();
	};

export const validateJsonBody: Middleware = async (request, env, ctx, next): Promise<Response> => {
	const url = new URL(request.url);

	if (request.method !== 'POST' || url.pathname !== '/api/protected') {
		return next();
	}

	const contentType = request.headers.get('Content-Type') ?? '';
	if (!contentType.toLowerCase().includes('application/json')) {
		return jsonResponse({ error: 'Expected JSON body' }, 415);
	}

	try {
		await request.clone().json();
	} catch {
		return jsonResponse({ error: 'Invalid JSON body' }, 400);
	}

	return next();
};

export const auth =
	(jwksUrl: string, audience: string): Middleware => {
		const jwks = createRemoteJWKSet(new URL(jwksUrl));

		return async (request, env, ctx, next): Promise<Response> => {
			if (request.url.includes('/health')) {
				return next();
			}

			const token = request.headers.get('Authorization')?.replace('Bearer ', '');
			if (!token) {
				return new Response(JSON.stringify({ error: 'Missing token' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			try {
				const { payload } = await jwtVerify<JwtClaims>(token, jwks, { audience });
				request.user = payload;
				return next();
			} catch {
				return new Response(JSON.stringify({ error: 'Invalid token' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		};
	};
