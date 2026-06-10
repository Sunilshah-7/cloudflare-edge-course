# Day 3: Wrangler—Installation & First Deployment

## Concepts

**Wrangler** is Cloudflare's CLI for developing, testing, and deploying Workers. It provides:
- Local dev server with hot-reload
- Type-safe configuration via `wrangler.toml`
- Secrets management
- Environment-based deployment
- Integration with Cloudflare's API

**Configuration File** (`wrangler.toml`):
```toml
name = "my-worker"
type = "javascript"
account_id = "your_account_id"
workers_dev = true  # Deploy to *.workers.dev

[env.production]
route = "api.example.com/worker/*"
zone_id = "your_zone_id"

[env.staging]
route = "staging-api.example.com/worker/*"
```

**Environment Concepts**: You can define separate `[env.name]` blocks to deploy the same code to different routes, with different secrets or configurations.

## Practical Focus

1. Install: `npm install -g wrangler` (or use `npx wrangler`)
2. Create: `wrangler init my-edge-app`
3. Edit `wrangler.toml` with your Cloudflare account info (find at https://dash.cloudflare.com)
4. Write a handler in `src/index.js`:
```javascript
export default {
  async fetch(request) {
    return new Response("Hello from the edge!", { status: 200 });
  }
};
```
5. Test locally: `wrangler dev` → visit http://localhost:8787
6. Deploy: `wrangler deploy`
7. Visit your deployed URL (e.g., `my-edge-app.your-name.workers.dev`)

## Key Takeaway

**Wrangler is your bridge from local dev to production edge—master its config syntax and you'll ship Workers confidently.**

## Reading

1. **Cloudflare**: [Wrangler Quick Start](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (~5 min)
2. **Cloudflare**: [Environments in Wrangler](https://developers.cloudflare.com/workers/wrangler/environments/) (~5 min)

## Bridge to Next Day

Tomorrow: **Headers, Cookies, and Request Transformation**—the core techniques used in 90% of Workers you'll write.
