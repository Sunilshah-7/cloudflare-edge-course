import { DurableObject } from 'cloudflare:workers';

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
		const queue = ((await this.ctx.storage.get<string[]>(QUEUE_KEY)) || []).filter(
			(storedItem): storedItem is string => typeof storedItem === 'string'
		);
		queue.push(item);
		await this.ctx.storage.put(QUEUE_KEY, queue);
		return queue.length;
	}

	async size(): Promise<number> {
		const queue = await this.ctx.storage.get<string[]>(QUEUE_KEY);
		return queue?.length || 0;
	}

	async processNext(): Promise<QueueProcessResult> {
		const lockExpiresAt = await this.ctx.storage.get<number>(LOCK_KEY);
		if (lockExpiresAt && lockExpiresAt > Date.now()) {
			return { locked: true, processed: false };
		}

		await this.ctx.storage.put(LOCK_KEY, Date.now() + LOCK_TTL_MS);

		try {
			const queue = ((await this.ctx.storage.get<string[]>(QUEUE_KEY)) || []).filter(
				(storedItem): storedItem is string => typeof storedItem === 'string'
			);
			const item = queue.shift();
			if (item === undefined) {
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
				throw new Error(`Queue handler failed: ${response.status}`);
			}

			return { processed: true, item };
		} finally {
			await this.ctx.storage.delete(LOCK_KEY);
		}
	}
}
