/// <reference types="@cloudflare/workers-types" />

import type { Counter } from './src/counter';

declare global {
	interface Env {
		JWKS_URL: string;
		API_KEY: string;
		API_ENDPOINT: string;
		DEBUG: boolean | string;
		FEATURE_FLAGS: KVNamespace;
		RATE_LIMIT: KVNamespace;
		COUNTER: DurableObjectNamespace<Counter>;
	}
}

export {};
