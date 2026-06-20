import { DurableObject } from 'cloudflare:workers';
import { logDurableObjectEvent, serializeError } from './doLogger';

interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfter: number;
	resetAt: number;
}

export class RateLimiter extends DurableObject<Env> {
	async check(userId: string, limit = 100, windowSeconds = 60): Promise<RateLimitResult> {
		const startTime = Date.now();
		const now = Date.now();
		const windowMs = windowSeconds * 1000;
		const countKey = `rate:${userId}:count`;
		const resetKey = `rate:${userId}:reset`;

		try {
			const result = await this.ctx.storage.transaction(async (txn) => {
				const storedCount = (await txn.get<number>(countKey)) || 0;
				const storedResetAt = (await txn.get<number>(resetKey)) || 0;
				const expired = storedResetAt <= now;
				const count = expired ? 0 : storedCount;
				const resetAt = expired ? now + windowMs : storedResetAt;

				if (count >= limit) {
					return {
						allowed: false,
						remaining: 0,
						retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
						resetAt,
					};
				}

				const nextCount = count + 1;
				await txn.put({
					[countKey]: nextCount,
					[resetKey]: resetAt,
				});

				return {
					allowed: true,
					remaining: Math.max(0, limit - nextCount),
					retryAfter: 0,
					resetAt,
				};
			});

			logDurableObjectEvent(this.ctx, 'RateLimiter', 'ratelimit.check', {
				userId,
				allowed: result.allowed,
				remaining: result.remaining,
				limit,
				windowSeconds,
				durationMs: Date.now() - startTime,
			});

			return result;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'RateLimiter',
				'ratelimit.error',
				{
					userId,
					limit,
					windowSeconds,
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}
}
