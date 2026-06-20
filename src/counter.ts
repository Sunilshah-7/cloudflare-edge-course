import { DurableObject } from 'cloudflare:workers';
import { logDurableObjectEvent, serializeError } from './doLogger';

export class Counter extends DurableObject<Env> {
	async get(): Promise<number> {
		const startTime = Date.now();

		try {
			const value = (await this.ctx.storage.get<number>('count')) || 0;
			logDurableObjectEvent(this.ctx, 'Counter', 'counter.get', {
				value,
				durationMs: Date.now() - startTime,
			});
			return value;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'Counter',
				'counter.error',
				{
					operation: 'get',
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}

	async increment(): Promise<number> {
		const startTime = Date.now();

		try {
			const current = (await this.ctx.storage.get<number>('count')) || 0;
			const next = current + 1;
			await this.ctx.storage.put('count', next);
			logDurableObjectEvent(this.ctx, 'Counter', 'counter.increment', {
				oldValue: current,
				newValue: next,
				durationMs: Date.now() - startTime,
			});
			return next;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'Counter',
				'counter.error',
				{
					operation: 'increment',
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}
}
