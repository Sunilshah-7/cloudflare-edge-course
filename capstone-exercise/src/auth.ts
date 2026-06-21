import type { AppEnv } from './env';

const COOKIE_NAME = 'notebook_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type Session = {
	userId: string;
	name: string;
	exp: number;
};

export async function getSession(request: Request, env: AppEnv): Promise<Session | null> {
	const cookie = request.headers.get('Cookie');
	if (!cookie) {
		return null;
	}

	const token = parseCookie(cookie)[COOKIE_NAME];
	if (!token) {
		return null;
	}

	return verifySession(token, env);
}

export async function createSession(name: string, env: AppEnv, userId = crypto.randomUUID()): Promise<{ session: Session; cookie: string }> {
	const session: Session = {
		userId,
		name: cleanName(name),
		exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
	};
	const token = await signPayload(session, env);
	return {
		session,
		cookie: `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax`,
	};
}

export async function signShare(
	payload: { docId: string; role: 'editor' | 'viewer'; exp: number },
	env: AppEnv,
): Promise<string> {
	return signPayload(payload, env);
}

export async function verifyShare(
	token: string,
	env: AppEnv,
): Promise<{ docId: string; role: 'editor' | 'viewer'; exp: number } | null> {
	const payload = await verifyPayload(token, env);
	if (!payload || typeof payload !== 'object') {
		return null;
	}
	const candidate = payload as Record<string, unknown>;
	if (
		typeof candidate.docId !== 'string' ||
		(candidate.role !== 'editor' && candidate.role !== 'viewer') ||
		typeof candidate.exp !== 'number' ||
		candidate.exp < Math.floor(Date.now() / 1000)
	) {
		return null;
	}
	return { docId: candidate.docId, role: candidate.role, exp: candidate.exp };
}

export function unauthorized(): Response {
	return Response.json({ error: 'A demo session is required.' }, { status: 401 });
}

async function verifySession(token: string, env: AppEnv): Promise<Session | null> {
	const payload = await verifyPayload(token, env);
	if (!payload || typeof payload !== 'object') {
		return null;
	}

	const candidate = payload as Record<string, unknown>;
	if (
		typeof candidate.userId !== 'string' ||
		typeof candidate.name !== 'string' ||
		typeof candidate.exp !== 'number' ||
		candidate.exp < Math.floor(Date.now() / 1000)
	) {
		return null;
	}

	return { userId: candidate.userId, name: candidate.name, exp: candidate.exp };
}

async function signPayload(payload: unknown, env: AppEnv): Promise<string> {
	const body = base64UrlEncode(JSON.stringify(payload));
	const signature = await hmac(body, env);
	return `${body}.${signature}`;
}

async function verifyPayload(token: string, env: AppEnv): Promise<unknown | null> {
	const [body, signature, extra] = token.split('.');
	if (!body || !signature || extra !== undefined) {
		return null;
	}

	const expected = await hmac(body, env);
	if (!constantTimeEqual(signature, expected)) {
		return null;
	}

	try {
		return JSON.parse(base64UrlDecode(body));
	} catch {
		return null;
	}
}

async function hmac(body: string, env: AppEnv): Promise<string> {
	if (!env.SESSION_SECRET) {
		throw new Error('SESSION_SECRET is required');
	}

	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(env.SESSION_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
	return base64UrlEncodeBytes(new Uint8Array(signature));
}

function parseCookie(header: string): Record<string, string> {
	const cookies: Record<string, string> = {};
	for (const pair of header.split(';')) {
		const [rawKey, ...rawValue] = pair.trim().split('=');
		if (rawKey) {
			cookies[rawKey] = rawValue.join('=');
		}
	}
	return cookies;
}

function cleanName(name: string): string {
	const trimmed = name.trim().slice(0, 60);
	return trimmed || `User ${crypto.randomUUID().slice(0, 8)}`;
}

function base64UrlEncode(value: string): string {
	return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(value: string): string {
	const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}

function constantTimeEqual(a: string, b: string): boolean {
	const left = new TextEncoder().encode(a);
	const right = new TextEncoder().encode(b);
	let diff = left.length ^ right.length;
	for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
		diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
	}
	return diff === 0;
}
