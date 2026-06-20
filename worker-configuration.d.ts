/// <reference types="@cloudflare/workers-types" />

import type { Counter } from './src/counter';
import type { Queue } from './src/queue';
import type { RateLimiter } from './src/rateLimiter';

declare global {
	interface Env {
		JWKS_URL: string;
		API_KEY: string;
		API_ENDPOINT: string;
		DEBUG: boolean | string;
		FEATURE_FLAGS: KVNamespace;
		RATE_LIMIT: KVNamespace;
		COUNTER: DurableObjectNamespace<Counter>;
		QUEUE: DurableObjectNamespace<Queue>;
		QUEUE_HANDLER?: Fetcher;
		RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
	}
}

export {};
