# Day 11: Local Development, Testing & Debugging

## Concepts

**Local Dev Server**: `wrangler dev` spins up a local HTTP server with hot-reload, matching the Workers runtime:
- File changes auto-reload
- Browser DevTools support
- KV, Durable Objects access (local mocks)
- Nearest to production parity outside of actual deployment

**Console Logs**: Use `console.log()` in your Worker. Output appears in:
- `wrangler dev` terminal
- Cloudflare Dashboard → Logs (for deployed Workers)
- A CLI tool: `wrangler tail` (streams live logs from production)

**Breakpoints & Debugging**: The `wrangler dev` output includes a DevTools URL. Open in Chrome for step-through debugging.

**Testing Strategy**: Unit test your logic separately; integration test by calling the Worker locally with different requests.

**KV Mocking**: `wrangler dev` creates local KV stores. Each Worker instance has its own, but subsequent requests share KV state within the session.

**Remote Debugging**: For production issues, use `wrangler tail` to stream logs:
```bash
wrangler tail --format pretty
# Streams live logs from your deployed Worker
```

## Practical Focus

Write a test for a Worker:

```javascript
// src/index.js
export async function handler(request, env) {
  const name = new URL(request.url).searchParams.get('name');
  if (!name) return new Response('Name required', { status: 400 });
  return new Response(`Hello ${name}`);
}

export default { fetch: handler };

// test/index.test.js
import { handler } from '../src/index';

describe('Worker', () => {
  test('greets user', async () => {
    const req = new Request('http://example.com/?name=Alice');
    const res = await handler(req, {});
    const text = await res.text();
    expect(text).toContain('Hello Alice');
  });
  
  test('rejects missing name', async () => {
    const req = new Request('http://example.com/');
    const res = await handler(req, {});
    expect(res.status).toBe(400);
  });
});
```

Run locally:
```bash
wrangler dev
# In another terminal:
curl http://localhost:8787/?name=Alice
# Response: Hello Alice
```

## Key Takeaway

**Test locally before deploying—`wrangler dev` is fast enough to TDD edge logic, especially for caching and rate limiting where production debugging is costly.**

## Reading

1. **Cloudflare**: [wrangler dev](https://developers.cloudflare.com/workers/wrangler/commands/#dev) (~5 min)
2. **Cloudflare**: [Wrangler Tail](https://developers.cloudflare.com/workers/wrangler/commands/#tail) — stream production logs (~3 min)

## Bridge to Next Day

Tomorrow: **Performance Optimization**—measure and reduce Worker CPU time and latency.
