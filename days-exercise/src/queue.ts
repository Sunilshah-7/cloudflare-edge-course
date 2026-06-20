import { DurableObject } from 'cloudflare:workers';
import { logDurableObjectEvent, serializeError } from './doLogger';

const QUEUE_KEY = 'queue';
const LOCK_KEY = 'processing-lock';
const LOCK_TTL_MS = 30_000;

export interface QueueProcessResult {
	locked?: boolean;
	processed: boolean;
	item?: string;
}

export class Queue extends DurableObject<Env> {
	async enqueue(item: string): Promise<number> {
		const startTime = Date.now();

		try {
			const queue = ((await this.ctx.storage.get<string[]>(QUEUE_KEY)) || []).filter(
				(storedItem): storedItem is string => typeof storedItem === 'string'
			);
			queue.push(item);
			await this.ctx.storage.put(QUEUE_KEY, queue);
			logDurableObjectEvent(this.ctx, 'Queue', 'queue.enqueue', {
				item,
				size: queue.length,
				durationMs: Date.now() - startTime,
			});
			return queue.length;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'Queue',
				'queue.error',
				{
					operation: 'enqueue',
					item,
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}

	async size(): Promise<number> {
		const startTime = Date.now();

		try {
			const queue = await this.ctx.storage.get<string[]>(QUEUE_KEY);
			const size = queue?.length || 0;
			logDurableObjectEvent(this.ctx, 'Queue', 'queue.size', {
				size,
				durationMs: Date.now() - startTime,
			});
			return size;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'Queue',
				'queue.error',
				{
					operation: 'size',
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}

	async processNext(): Promise<QueueProcessResult> {
		const startTime = Date.now();
		let item: string | undefined;
		let lockAcquired = false;

		try {
			const lockExpiresAt = await this.ctx.storage.get<number>(LOCK_KEY);
			if (lockExpiresAt && lockExpiresAt > Date.now()) {
				logDurableObjectEvent(this.ctx, 'Queue', 'queue.process.locked', {
					lockExpiresAt,
					durationMs: Date.now() - startTime,
				});
				return { locked: true, processed: false };
			}

			await this.ctx.storage.put(LOCK_KEY, Date.now() + LOCK_TTL_MS);
			lockAcquired = true;

			const queue = ((await this.ctx.storage.get<string[]>(QUEUE_KEY)) || []).filter(
				(storedItem): storedItem is string => typeof storedItem === 'string'
			);
			item = queue.shift();
			if (item === undefined) {
				logDurableObjectEvent(this.ctx, 'Queue', 'queue.process.empty', {
					durationMs: Date.now() - startTime,
				});
				return { processed: false };
			}

			await this.ctx.storage.put(QUEUE_KEY, queue);
			const queueHandler = this.env.QUEUE_HANDLER ?? { fetch };
			const response = await queueHandler.fetch('http://handler.internal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(item),
			});

			if (!response.ok) {
				queue.unshift(item);
				await this.ctx.storage.put(QUEUE_KEY, queue);
				logDurableObjectEvent(
					this.ctx,
					'Queue',
					'queue.process.handler_failed',
					{
						item,
						status: response.status,
						size: queue.length,
						durationMs: Date.now() - startTime,
					},
					'error'
				);
				throw new Error(`Queue handler failed: ${response.status}`);
			}

			logDurableObjectEvent(this.ctx, 'Queue', 'queue.process.processed', {
				item,
				size: queue.length,
				durationMs: Date.now() - startTime,
			});
			return { processed: true, item };
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'Queue',
				'queue.error',
				{
					operation: 'processNext',
					item,
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		} finally {
			if (lockAcquired) {
				await this.ctx.storage.delete(LOCK_KEY);
			}
		}
	}
}
