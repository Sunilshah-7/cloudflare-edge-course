import { Counter } from './counter';

export { Counter };

interface Env {
	COUNTER: DurableObjectNamespace<Counter>;
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/counter' && request.headers.get('Upgrade') === 'websocket') {
			const counterId = url.searchParams.get('id') ?? 'default';
			const counter = env.COUNTER.getByName(counterId);
			return counter.fetch(request);
		}

		if (url.pathname === '/counter/get') {
			const counterId = url.searchParams.get('id') ?? 'default';
			const counter = env.COUNTER.getByName(counterId);
			return counter.fetch(request);
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
