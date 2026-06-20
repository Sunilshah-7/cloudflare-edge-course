import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../src';

const encoder = new TextEncoder();

function base64Url(value: ArrayBuffer | string): string {
	const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createSignedJWT(
	privateKey: CryptoKey,
	kid: string,
	payload: Record<string, unknown>
): Promise<string> {
	const header = { alg: 'RS256', kid, typ: 'JWT' };
	const encodedHeader = base64Url(JSON.stringify(header));
	const encodedPayload = base64Url(JSON.stringify(payload));
	const data = encoder.encode(`${encodedHeader}.${encodedPayload}`);
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
	return `${encodedHeader}.${encodedPayload}.${base64Url(signature)}`;
}

async function createKeyPair(kid: string) {
	const keyPair = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256',
		},
		true,
		['sign', 'verify']
	);

	const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
	return {
		privateKey: keyPair.privateKey,
		publicJwk: {
			...publicJwk,
			alg: 'RS256',
			kid,
			use: 'sig',
		},
	};
}

function createEnv(jwksUrl: string, overrides: Partial<Env> = {}): Env {
	return {
		...env,
		JWKS_URL: jwksUrl,
		API_KEY: 'test-api-key',
		API_ENDPOINT: 'https://api.example.test/data',
		DEBUG: false,
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('JWT auth middleware', () => {
	it('returns 401 when the bearer token is missing', async () => {
		const ctx = createExecutionContext();
		const response = await handler(
			new Request('https://app.example.com/api/profile'),
			createEnv('https://issuer.example.com/missing-token/jwks.json'),
			ctx
		);

		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Unauthorized');
	});

	it('verifies a JWT and calls configured APIs in parallel with secret auth and user headers', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const token = await createSignedJWT(privateKey, kid, {
			sub: 'user_123',
			scope: 'read:profile write:profile',
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const apiRequests: Array<{
			url: string;
			authorization: string | null;
			userId: string | null;
			scope: string | null;
		}> = [];
		let activeAPIFetches = 0;
		let maxActiveAPIFetches = 0;

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'max-age=60',
					},
				});
			}

			activeAPIFetches++;
			maxActiveAPIFetches = Math.max(maxActiveAPIFetches, activeAPIFetches);
			apiRequests.push({
				url: request.url,
				authorization: request.headers.get('Authorization'),
				userId: request.headers.get('X-User-ID'),
				scope: request.headers.get('X-User-Scope'),
			});
			await Promise.resolve();
			activeAPIFetches--;

			return new Response(
				JSON.stringify({ resource: request.url.split('/').at(-1), url: request.url }),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		});

		const ctx = createExecutionContext();
		const response = await handler(
			new Request('https://app.example.com/api/profile', {
				headers: { Authorization: `Bearer ${token}` },
			}),
			createEnv(jwksUrl, {
				API_KEY: 'upstream-secret',
				API_ENDPOINT: 'https://api.example.test/profile',
				DEBUG: true,
			}),
			ctx
		);

		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			user: { resource: 'profile', url: 'https://api.example.test/profile' },
			posts: { resource: 'posts', url: 'https://api.example.test/profile/posts' },
			comments: { resource: 'comments', url: 'https://api.example.test/profile/comments' },
		});
		expect(apiRequests).toEqual([
			{
				url: 'https://api.example.test/profile',
				authorization: 'Bearer upstream-secret',
				userId: 'user_123',
				scope: 'read:profile write:profile',
			},
			{
				url: 'https://api.example.test/profile/posts',
				authorization: 'Bearer upstream-secret',
				userId: 'user_123',
				scope: 'read:profile write:profile',
			},
			{
				url: 'https://api.example.test/profile/comments',
				authorization: 'Bearer upstream-secret',
				userId: 'user_123',
				scope: 'read:profile write:profile',
			},
		]);
		expect(maxActiveAPIFetches).toBe(3);
		expect(log).toHaveBeenCalledWith(
			'Calling https://api.example.test/profile, https://api.example.test/profile/posts, https://api.example.test/profile/comments'
		);
	});

	it('returns 401 when the JWT signature is invalid', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const trustedKeys = await createKeyPair(kid);
		const untrustedKeys = await createKeyPair(kid);
		const token = await createSignedJWT(untrustedKeys.privateKey, kid, {
			sub: 'user_123',
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [trustedKeys.publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		const ctx = createExecutionContext();
		const response = await handler(
			new Request('https://app.example.com/api/profile', {
				headers: { Authorization: `Bearer ${token}` },
			}),
			createEnv(jwksUrl),
			ctx
		);

		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Unauthorized');
	});
});
