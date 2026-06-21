import { DurableObject } from 'cloudflare:workers';

type CounterCommand =
	| { type: 'increment'; clientId?: string }
	| { type: 'decrement'; clientId?: string }
	| { type: 'reset'; clientId?: string };

type CounterOperation = {
	type: CounterCommand['type'];
	clientId: string;
	value: number;
	timestamp: number;
};

type CounterBroadcast =
	| {
			type: 'init';
			value: number;
			activeUsers: number;
			users: string[];
			ownerId: string | null;
			history: CounterOperation[];
	  }
	| { type: 'users'; activeUsers: number; users: string[] }
	| { type: 'update'; value: number; from: string; history: CounterOperation[] };

export class Counter extends DurableObject {
	private readonly clients = new Set<WebSocket>();
	private readonly clientIds = new Map<WebSocket, string>();

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.headers.get('Upgrade') === 'websocket') {
			const clientId = url.searchParams.get('clientId') ?? crypto.randomUUID();
			const { 0: client, 1: server } = new WebSocketPair();

			server.accept();
			this.clients.add(server);
			this.clientIds.set(server, clientId);

			const ownerId = await this.getOrCreateOwner(clientId);

			const count = (await this.ctx.storage.get<number>('count')) ?? 0;
			const history = await this.getHistory();
			server.send(
				JSON.stringify({
					type: 'init',
					value: count,
					activeUsers: this.getUsers().length,
					users: this.getUsers(),
					ownerId,
					history,
				} satisfies CounterBroadcast),
			);
			this.broadcastUsers();

			server.addEventListener('message', async (event: MessageEvent) => {
				if (typeof event.data !== 'string') {
					return;
				}

				try {
					await this.handleMessage(server, JSON.parse(event.data) as CounterCommand);
				} catch {
					server.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
				}
			});

			server.addEventListener('close', () => {
				this.clients.delete(server);
				this.clientIds.delete(server);
				this.broadcastUsers();
			});

			return new Response(null, { status: 101, webSocket: client });
		}

		if (url.pathname === '/get') {
			const count = (await this.ctx.storage.get<number>('count')) ?? 0;
			const ownerId = (await this.ctx.storage.get<string>('ownerId')) ?? null;
			return Response.json({
				value: count,
				activeUsers: this.getUsers().length,
				users: this.getUsers(),
				ownerId,
				history: await this.getHistory(),
			});
		}

		return new Response('Upgrade required', { status: 400 });
	}

	private async handleMessage(sender: WebSocket, msg: CounterCommand): Promise<void> {
		const clientId = this.clientIds.get(sender) ?? msg.clientId;

		if (!clientId || !this.isCounterCommand(msg)) {
			sender.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
			return;
		}

		if (msg.type === 'increment') {
			const current = (await this.ctx.storage.get<number>('count')) ?? 0;
			const newValue = current + 1;
			await this.ctx.storage.put('count', newValue);
			const history = await this.recordOperation('increment', clientId, newValue);

			this.broadcast({
				type: 'update',
				value: newValue,
				from: clientId,
				history,
			});
		} else if (msg.type === 'decrement') {
			const current = (await this.ctx.storage.get<number>('count')) ?? 0;
			const newValue = Math.max(0, current - 1);
			await this.ctx.storage.put('count', newValue);
			const history = await this.recordOperation('decrement', clientId, newValue);

			this.broadcast({
				type: 'update',
				value: newValue,
				from: clientId,
				history,
			});
		} else if (msg.type === 'reset') {
			const ownerId = await this.ctx.storage.get<string>('ownerId');
			if (ownerId !== clientId) {
				sender.send(JSON.stringify({ type: 'error', message: 'Only the counter owner can reset.' }));
				return;
			}

			await this.ctx.storage.put('count', 0);
			const history = await this.recordOperation('reset', clientId, 0);
			this.broadcast({
				type: 'update',
				value: 0,
				from: clientId,
				history,
			});
		}
	}

	private broadcast(message: CounterBroadcast): void {
		const data = JSON.stringify(message);
		for (const client of this.clients) {
			client.send(data);
		}
	}

	private broadcastUsers(): void {
		const users = this.getUsers();
		this.broadcast({
			type: 'users',
			activeUsers: users.length,
			users,
		});
	}

	private getUsers(): string[] {
		return [...new Set(this.clientIds.values())].sort();
	}

	private async getOrCreateOwner(clientId: string): Promise<string> {
		const ownerId = await this.ctx.storage.get<string>('ownerId');
		if (ownerId) {
			return ownerId;
		}

		await this.ctx.storage.put('ownerId', clientId);
		return clientId;
	}

	private async getHistory(): Promise<CounterOperation[]> {
		return (await this.ctx.storage.get<CounterOperation[]>('history')) ?? [];
	}

	private async recordOperation(
		type: CounterOperation['type'],
		clientId: string,
		value: number,
	): Promise<CounterOperation[]> {
		const history = await this.getHistory();
		const nextHistory = [
			...history,
			{
				type,
				clientId,
				value,
				timestamp: Date.now(),
			},
		].slice(-10);

		await this.ctx.storage.put('history', nextHistory);
		return nextHistory;
	}

	private isCounterCommand(msg: CounterCommand): msg is CounterCommand {
		return msg.type === 'increment' || msg.type === 'decrement' || msg.type === 'reset';
	}
}
