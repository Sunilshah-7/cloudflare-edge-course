import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('collaborative counter worker', () => {
	it('returns 404 for unknown routes', async () => {
		const response = await SELF.fetch('http://example.com/unknown');

		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe('Not found');
	});
});
