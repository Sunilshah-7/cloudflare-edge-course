# Day 10: Secrets, Environment Variables & Configuration

## Concepts

**Environment Variables**: Non-secret configuration (API URLs, feature flags, timeouts). Defined in `wrangler.toml`:
```toml
[env.production]
vars = { API_ENDPOINT = "https://api.example.com", DEBUG = false }
```

Accessed in code as `env.API_ENDPOINT`.

**Secrets**: Sensitive data (API keys, DB passwords, JWT private keys). **Never** hardcode in source. Store in Cloudflare's encrypted secret store:

```bash
wrangler secret put API_KEY --env production
# Prompts for value, stores encrypted
```

Access via `env.API_KEY` (identical to vars, but never logged or exposed).

**Local Secrets**: For development, use a `.env.local` file (git-ignored):
```
API_KEY=test-key-12345
DB_PASSWORD=local-dev-pass
```

**Rotation**: Update secrets via `wrangler secret put` again. Deploy without code change.

**Environment-Aware Config**:
```toml
[env.staging]
vars = { API_ENDPOINT = "https://staging-api.example.com" }
secret_key = "staging"

[env.production]
vars = { API_ENDPOINT = "https://api.example.com" }
secret_key = "prod"
```

Deploy to staging: `wrangler deploy --env staging`

## Practical Focus

Build a Worker that reads secrets and config:

```javascript
export default {
  async fetch(request, env) {
    const apiKey = env.API_KEY; // Secret
    const endpoint = env.API_ENDPOINT; // Var
    const debug = env.DEBUG; // Var (boolean)
    
    if (debug) {
      console.log(`Calling ${endpoint}`);
    }
    
    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    return response;
  }
};
```

`wrangler.toml`:
```toml
name = "my-worker"
type = "javascript"

[env.staging]
vars = { API_ENDPOINT = "https://staging.example.com", DEBUG = true }

[env.production]
vars = { API_ENDPOINT = "https://api.example.com", DEBUG = false }
```

## Key Takeaway

**Secrets are for sensitive data, vars for config—don't mix them, and always rotate secrets when developers leave.**

## Reading

1. **Cloudflare**: [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) (~5 min)
2. **Cloudflare**: [Environment Variables & Secrets](https://developers.cloudflare.com/workers/configuration/environment-variables/) (~3 min)

## Bridge to Next Day

Tomorrow: **Local Development & Debugging**—test Workers locally before deploying.
