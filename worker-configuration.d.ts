/// <reference types="@cloudflare/workers-types" />

interface Env {
	JWKS_URL: string;
	FEATURE_FLAGS: KVNamespace;
	RATE_LIMIT: KVNamespace;
}
