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

function createAnalyticsEngine() {
	const points: AnalyticsEngineDataPoint[] = [];
	const dataset: AnalyticsEngineDataset = {
		writeDataPoint(point?: AnalyticsEngineDataPoint) {
			if (point) {
				points.push(point);
			}
		},
	};

	return { dataset, points };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('JWT auth middleware', () => {
	it('serves an unauthenticated health check for deployment monitoring', async () => {
		const { dataset, points } = createAnalyticsEngine();
		const ctx = createExecutionContext();
		const response = await handler(
			new Request('https://app.example.com/health'),
			createEnv('https://issuer.example.com/health/jwks.json', {
				ANALYTICS_ENGINE: dataset,
			}),
			ctx
		);

		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: 'ok',
			service: 'my-edge-app',
			timestamp: expect.any(String),
		});
		expect(points).toHaveLength(1);
		expect(points[0]).toMatchObject({
			indexes: ['/health'],
			doubles: [expect.any(Number), 200, 0, 0, 0],
			blobs: ['/health', 'unknown', 'GET'],
		});
	});

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

	it('writes API latency analytics for each endpoint response', async () => {
		const { dataset, points } = createAnalyticsEngine();
		const ctx = createExecutionContext();
		const response = await handler(
			new Request('https://app.example.com/api/profile', {
				cf: { country: 'US' },
			}),
			createEnv('https://issuer.example.com/missing-token/jwks.json', {
				ANALYTICS_ENGINE: dataset,
			}),
			ctx
		);

		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		expect(points).toHaveLength(1);
		expect(points[0]).toEqual({
			indexes: ['/api/profile'],
			doubles: [expect.any(Number), 401, 0, 0, 0],
			blobs: ['/api/profile', 'US', 'GET'],
		});
		expect(points[0].doubles?.[0]).toBeGreaterThanOrEqual(0);
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
			await new Promise((resolve) => setTimeout(resolve, 1));
			activeAPIFetches--;

			return new Response(
				JSON.stringify({ resource: request.url.split('/').at(-1), url: request.url }),
				{
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'public, max-age=60',
					},
				}
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

	it('serves a secure user API with validated IDs and security headers', async () => {
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const token = await createSignedJWT(privateKey, kid, {
			sub: 'secure_user',
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		async function apiUser(path: string, method = 'GET') {
			const ctx = createExecutionContext();
			const response = await handler(
				new Request(`https://app.example.com${path}`, {
					method,
					headers: { Authorization: `Bearer ${token}` },
				}),
				createEnv(jwksUrl),
				ctx
			);
			await waitOnExecutionContext(ctx);
			return response;
		}

		const ok = await apiUser('/api/user?id=alice123');
		expect(ok.status).toBe(200);
		expect(ok.headers.get('Content-Type')).toContain('application/json');
		expect(ok.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
		expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff');
		await expect(ok.json()).resolves.toEqual({ id: 'alice123', name: 'Alice' });

		const invalid = await apiUser('/api/user?id=Alice_123');
		expect(invalid.status).toBe(400);
		expect(invalid.headers.get('X-Content-Type-Options')).toBe('nosniff');
		await expect(invalid.json()).resolves.toEqual({ error: 'Invalid user ID' });

		const missing = await apiUser('/api/user?id=missing');
		expect(missing.status).toBe(404);
		await expect(missing.json()).resolves.toEqual({ error: 'Not found' });

		const wrongMethod = await apiUser('/api/user?id=alice123', 'POST');
		expect(wrongMethod.status).toBe(405);
		await expect(wrongMethod.json()).resolves.toEqual({ error: 'Method not allowed' });
	});

	it('stores a per-user counter in a Durable Object', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const userToken = await createSignedJWT(privateKey, kid, {
			sub: 'counter_user',
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const otherUserToken = await createSignedJWT(privateKey, kid, {
			sub: 'counter_other_user',
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		async function counter(path: 'get' | 'increment', token = userToken) {
			const ctx = createExecutionContext();
			const response = await handler(
				new Request(`https://app.example.com/counter/${path}`, {
					headers: { Authorization: `Bearer ${token}` },
				}),
				createEnv(jwksUrl),
				ctx
			);
			await waitOnExecutionContext(ctx);
			return response;
		}

		await expect((await counter('get')).text()).resolves.toBe('0');
		await expect((await counter('increment')).text()).resolves.toBe('1');
		await expect((await counter('increment')).text()).resolves.toBe('2');
		await expect((await counter('get')).text()).resolves.toBe('2');
		await expect((await counter('get', otherUserToken)).text()).resolves.toBe('0');

		const counterLogs = log.mock.calls
			.map(([entry]) => JSON.parse(entry as string) as Record<string, unknown>)
			.filter((entry) => entry.doClass === 'Counter');
		expect(counterLogs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					level: 'info',
					doClass: 'Counter',
					event: 'counter.increment',
					oldValue: 0,
					newValue: 1,
				}),
			])
		);
		expect(counterLogs[0]).toEqual(
			expect.objectContaining({
				timestamp: expect.any(String),
				doId: expect.any(String),
				durationMs: expect.any(Number),
			})
		);
	});

	it('rate limits concurrent requests with Durable Object storage transactions', async () => {
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const token = await createSignedJWT(privateKey, kid, {
			sub: `rate_user_${kid}`,
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		const responses = await Promise.all(
			Array.from({ length: 5 }, async () => {
				const ctx = createExecutionContext();
				const response = await handler(
					new Request('https://app.example.com/ratelimit/check?limit=2&window=60', {
						headers: { Authorization: `Bearer ${token}` },
					}),
					createEnv(jwksUrl),
					ctx
				);
				await waitOnExecutionContext(ctx);
				return response;
			})
		);
		const statuses = responses.map((response) => response.status).sort();
		const shards = new Set(
			responses.map((response) => response.headers.get('X-RateLimit-Shard'))
		);
		const shardKeys = new Set(
			responses.map((response) => response.headers.get('X-RateLimit-Shard-Key'))
		);

		expect(statuses).toEqual([200, 200, 429, 429, 429]);
		expect(shards.size).toBe(1);
		expect(shardKeys.size).toBe(1);
		for (const response of responses.filter((response) => response.status === 429)) {
			expect(response.headers.get('Retry-After')).toBeTruthy();
			expect(await response.text()).toBe('Rate limited');
		}
	});

	it('routes rate limit checks through deterministic Durable Object shards', async () => {
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const token = await createSignedJWT(privateKey, kid, {
			sub: `rate_shard_user_${kid}`,
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		const authedEnv = createEnv(jwksUrl);
		const authHeaders = { Authorization: `Bearer ${token}` };

		async function checkUser(userId: string) {
			const ctx = createExecutionContext();
			const response = await handler(
				new Request(
					`https://app.example.com/ratelimit/check?user_id=${userId}&limit=10&window=60`,
					{
						headers: authHeaders,
					}
				),
				authedEnv,
				ctx
			);
			await waitOnExecutionContext(ctx);
			return response;
		}

		const firstAlice = await checkUser('alice');
		const secondAlice = await checkUser('alice');
		const bob = await checkUser('bob');

		expect(firstAlice.status).toBe(200);
		expect(secondAlice.status).toBe(200);
		expect(bob.status).toBe(200);
		expect(firstAlice.headers.get('X-RateLimit-Shard')).toBe(
			secondAlice.headers.get('X-RateLimit-Shard')
		);
		expect(firstAlice.headers.get('X-RateLimit-Shard-Key')).toBe(
			secondAlice.headers.get('X-RateLimit-Shard-Key')
		);
		expect(firstAlice.headers.get('X-RateLimit-Shard')).not.toBe(
			bob.headers.get('X-RateLimit-Shard')
		);
	});

	it('enqueues items and processes only one item while the lock is held', async () => {
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const token = await createSignedJWT(privateKey, kid, {
			sub: `queue_user_${kid}`,
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const handledItems: unknown[] = [];
		let markHandlerStarted: (() => void) | undefined;
		let releaseHandler: (() => void) | undefined;
		const handlerStarted = new Promise<void>((resolve) => {
			markHandlerStarted = resolve;
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (request.url === 'http://handler.internal/') {
				handledItems.push(await request.json());
				markHandlerStarted?.();
				await new Promise<void>((release) => {
					releaseHandler = release;
				});
				return new Response('Handled');
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		const authedEnv = createEnv(jwksUrl);
		const authHeaders = { Authorization: `Bearer ${token}` };

		async function queueRequest(path: string) {
			const ctx = createExecutionContext();
			const response = await handler(
				new Request(`https://app.example.com${path}`, { headers: authHeaders }),
				authedEnv,
				ctx
			);
			await waitOnExecutionContext(ctx);
			return response;
		}

		await expect((await queueRequest('/queue/enqueue?item=alpha')).json()).resolves.toEqual({
			status: 'enqueued',
			size: 1,
		});
		await expect((await queueRequest('/queue/enqueue?item=beta')).json()).resolves.toEqual({
			status: 'enqueued',
			size: 2,
		});

		const firstProcess = queueRequest('/queue/process');
		await handlerStarted;
		const locked = await queueRequest('/queue/process');
		expect(locked.status).toBe(409);
		expect(await locked.text()).toBe('Already processing');

		releaseHandler?.();
		await expect((await firstProcess).json()).resolves.toEqual({
			status: 'processed',
			item: 'alpha',
		});
		expect(handledItems).toEqual(['alpha']);
		await expect((await queueRequest('/queue/size')).json()).resolves.toEqual({ size: 1 });
	});

	it('stores ledger entries in SQL and returns per-user balances', async () => {
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const userToken = await createSignedJWT(privateKey, kid, {
			sub: `ledger_user_${kid}`,
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const otherUserToken = await createSignedJWT(privateKey, kid, {
			sub: `ledger_other_user_${kid}`,
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		async function ledger(path: string, token = userToken) {
			const ctx = createExecutionContext();
			const response = await handler(
				new Request(`https://app.example.com${path}`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}` },
				}),
				createEnv(jwksUrl),
				ctx
			);
			await waitOnExecutionContext(ctx);
			return response;
		}

		const first = await ledger('/ledger/add?amount=10.5&description=deposit');
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as {
			status: string;
			entry: { id: number; userId: string; amount: number; description: string };
		};
		expect(firstBody.status).toBe('added');
		expect(firstBody.entry.id).toBe(1);
		expect(firstBody.entry.amount).toBe(10.5);
		expect(firstBody.entry.description).toBe('deposit');

		await expect((await ledger('/ledger/add?amount=-2.25&description=debit')).json()).resolves
			.toMatchObject({
				status: 'added',
				entry: {
					amount: -2.25,
					description: 'debit',
				},
			});
		await expect((await ledger('/ledger/add?amount=7', otherUserToken)).json()).resolves
			.toMatchObject({
				status: 'added',
				entry: {
					amount: 7,
				},
			});

		await expect((await ledger('/ledger/balance')).json()).resolves.toEqual({
			userId: `ledger_user_${kid}`,
			balance: 8.25,
		});
		await expect((await ledger('/ledger/balance', otherUserToken)).json()).resolves.toEqual({
			userId: `ledger_other_user_${kid}`,
			balance: 7,
		});
	});

	it('routes user state to deterministic shards and isolates preferences by user', async () => {
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const userId = `state_user_${kid}`;
		const otherUserId = `state_other_user_${kid}`;
		const userToken = await createSignedJWT(privateKey, kid, {
			sub: userId,
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const otherUserToken = await createSignedJWT(privateKey, kid, {
			sub: otherUserId,
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Unexpected upstream fetch', { status: 500 });
		});

		async function userState(path: string, token = userToken) {
			const ctx = createExecutionContext();
			const response = await handler(
				new Request(`https://app.example.com${path}`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}` },
				}),
				createEnv(jwksUrl),
				ctx
			);
			await waitOnExecutionContext(ctx);
			return response;
		}

		const setTheme = await userState('/user-state/set-preference?key=theme&value=dark');
		expect(setTheme.status).toBe(200);
		const setThemeBody = (await setTheme.json()) as {
			userId: string;
			shardId: number;
			shardKey: string;
			preference: { key: string; value: string };
		};
		expect(setThemeBody.userId).toBe(userId);
		expect(setThemeBody.shardKey).toBe(`user-state:${setThemeBody.shardId}`);
		expect(setThemeBody.preference).toMatchObject({ key: 'theme', value: 'dark' });

		await expect((await userState('/user-state/set-preference?key=density&value=compact')).json())
			.resolves.toMatchObject({
				userId,
				shardId: setThemeBody.shardId,
				shardKey: setThemeBody.shardKey,
				preference: { key: 'density', value: 'compact' },
			});
		await expect((await userState('/user-state/set-preference?key=theme&value=light', otherUserToken)).json())
			.resolves.toMatchObject({
				userId: otherUserId,
				preference: { key: 'theme', value: 'light' },
			});

		await expect((await userState('/user-state/get-preference?key=theme')).json()).resolves
			.toMatchObject({
				userId,
				shardId: setThemeBody.shardId,
				shardKey: setThemeBody.shardKey,
				preference: { key: 'theme', value: 'dark' },
			});
		await expect((await userState('/user-state/get-preference?key=theme', otherUserToken)).json())
			.resolves.toMatchObject({
				userId: otherUserId,
				preference: { key: 'theme', value: 'light' },
			});

		const preferences = (await (await userState('/user-state/preferences')).json()) as {
			preferences: Array<{ key: string; value: string }>;
		};
		expect(preferences.preferences).toMatchObject([
			{ key: 'density', value: 'compact' },
			{ key: 'theme', value: 'dark' },
		]);
	});

	it('serves cached API responses when the origin fails later', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const { dataset, points } = createAnalyticsEngine();
		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const endpoint = `https://api.example.test/${kid}/profile`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const token = await createSignedJWT(privateKey, kid, {
			sub: 'user_cache',
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		let failAPI = false;
		let apiFetches = 0;

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			apiFetches++;
			if (failAPI) {
				throw new Error('Origin unavailable');
			}

			return Response.json(
				{
					resource: request.url.split('/').at(-1),
					from: 'origin',
				},
				{
					headers: { 'Cache-Control': 'public, max-age=60' },
				}
			);
		});

		const request = new Request('https://app.example.com/api/profile', {
			headers: { Authorization: `Bearer ${token}` },
		});
		const firstCtx = createExecutionContext();
		const first = await handler(
			request,
			createEnv(jwksUrl, {
				API_ENDPOINT: endpoint,
				ANALYTICS_ENGINE: dataset,
			}),
			firstCtx
		);

		await waitOnExecutionContext(firstCtx);
		expect(first.status).toBe(200);
		await expect(first.json()).resolves.toEqual({
			user: { resource: 'profile', from: 'origin' },
			posts: { resource: 'posts', from: 'origin' },
			comments: { resource: 'comments', from: 'origin' },
		});
		expect(apiFetches).toBe(3);

		failAPI = true;

		const secondCtx = createExecutionContext();
		const second = await handler(
			request,
			createEnv(jwksUrl, {
				API_ENDPOINT: endpoint,
				ANALYTICS_ENGINE: dataset,
			}),
			secondCtx
		);

		await waitOnExecutionContext(secondCtx);
		expect(second.status).toBe(200);
		await expect(second.json()).resolves.toEqual({
			user: { resource: 'profile', from: 'origin' },
			posts: { resource: 'posts', from: 'origin' },
			comments: { resource: 'comments', from: 'origin' },
		});
		expect(apiFetches).toBe(3);
		expect(points).toHaveLength(2);
		expect(points[0]).toEqual({
			indexes: ['/api/profile'],
			doubles: [expect.any(Number), 200, 0, 3, 3],
			blobs: ['/api/profile', 'unknown', 'GET'],
		});
		expect(points[1]).toEqual({
			indexes: ['/api/profile'],
			doubles: [expect.any(Number), 200, 1, 3, 0],
			blobs: ['/api/profile', 'unknown', 'GET'],
		});
	});

	it('returns 503 when the API origin fails and no cache entry exists', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const kid = crypto.randomUUID();
		const jwksUrl = `https://issuer.example.com/${kid}/jwks.json`;
		const { privateKey, publicJwk } = await createKeyPair(kid);
		const token = await createSignedJWT(privateKey, kid, {
			sub: 'user_no_cache',
			exp: Math.floor(Date.now() / 1000) + 300,
		});

		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);

			if (request.url === jwksUrl) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			throw new Error('Origin unavailable');
		});

		const ctx = createExecutionContext();
		const response = await handler(
			new Request('https://app.example.com/api/profile', {
				headers: { Authorization: `Bearer ${token}` },
			}),
			createEnv(jwksUrl, {
				API_ENDPOINT: `https://api.example.test/${kid}/profile`,
			}),
			ctx
		);

		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(503);
		expect(await response.text()).toBe('Service unavailable (origin down)');
	});
});
