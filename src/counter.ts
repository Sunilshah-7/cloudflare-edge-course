import { DurableObject } from 'cloudflare:workers';

export class Counter extends DurableObject<Env> {
	async get(): Promise<number> {
		return (await this.ctx.storage.get<number>('count')) || 0;
	}

	async increment(): Promise<number> {
		const current = await this.get();
		const next = current + 1;
		await this.ctx.storage.put('count', next);
		return next;
	}
}
