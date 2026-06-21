import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth, compose, type MiddlewareHandler } from '../src/middleware';
import worker from '../src';

describe('middleware auth worker', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('allows public health checks', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/health', {
			headers: { 'CF-Connecting-IP': '203.0.113.10' },
		});
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it('requires JSON content for POST /api/protected', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			'http://example.com/api/protected',
			{
				method: 'POST',
				headers: { 'CF-Connecting-IP': '203.0.113.20' },
				body: 'not json',
			},
		);
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(415);
		expect(await response.json()).toEqual({ error: 'Expected JSON body' });
	});

	it('rejects invalid JSON for POST /api/protected', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			'http://example.com/api/protected',
			{
				method: 'POST',
				headers: {
					'CF-Connecting-IP': '203.0.113.30',
					'Content-Type': 'application/json',
				},
				body: '{',
			},
		);
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
	});

	it('limits requests to 10 per minute per IP', async () => {
		const ip = '203.0.113.40';

		for (let i = 0; i < 10; i += 1) {
			const ctx = createExecutionContext();
			const response = await worker.fetch(
				new Request<unknown, IncomingRequestCfProperties>('http://example.com/health', {
					headers: { 'CF-Connecting-IP': ip },
				}),
				env,
				ctx,
			);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		}

		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request<unknown, IncomingRequestCfProperties>('http://example.com/health', {
				headers: { 'CF-Connecting-IP': ip },
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBeTruthy();
		expect(await response.json()).toEqual({ error: 'Rate limit exceeded' });
	});

	it('verifies JWTs with jose and attaches claims to the request', async () => {
		const audience = 'test-audience';
		const jwksUrl = 'https://issuer.example.com/.well-known/jwks.json';
		const { publicKey, privateKey } = await generateKeyPair('RS256');
		const publicJwk = await exportJWK(publicKey);
		publicJwk.kid = 'test-key';
		publicJwk.alg = 'RS256';
		publicJwk.use = 'sig';

		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(JSON.stringify({ keys: [publicJwk] }), {
					headers: { 'Content-Type': 'application/json' },
				}),
		);

		const token = await new SignJWT({ sub: 'user-123' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
			.setAudience(audience)
			.setIssuedAt()
			.setExpirationTime('2m')
			.sign(privateKey);

		const protectedHandler: MiddlewareHandler = async (request) =>
			new Response(JSON.stringify({ user: request.user }), {
				headers: { 'Content-Type': 'application/json' },
			});
		const handler = compose([auth(jwksUrl, audience)], protectedHandler);
		const ctx = createExecutionContext();

		const response = await handler(
			new Request<unknown, IncomingRequestCfProperties>('http://example.com/me', {
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		const body = (await response.json()) as { user: { aud: string; sub: string } };

		expect(response.status).toBe(200);
		expect(body.user.sub).toBe('user-123');
		expect(body.user.aud).toBe(audience);
	});
});
