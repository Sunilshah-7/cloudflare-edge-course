# Day 2: The Worker Runtime—Constraints & Capabilities

## Concepts

**The V8 Isolation Model**: Cloudflare pools V8 instances across many Worker functions. Each request spins up a lightweight isolate (not a container, not a process—isolated JavaScript context). Startup time: ~1–5ms for repeat requests on warm instances.

**Constraint: No Real Async I/O**: You can't use `setInterval`, `setTimeout`, or file system access. Network requests (fetch) are **allowed**, but your handler must resolve all fetches before returning. No background jobs, no timers.

**Constraint: CPU Time Limits**: ~30 seconds of CPU time before Worker terminates. This prevents runaway compute.

**Capability: Request Interception**: You see the full request before it hits your origin. You can cache, modify headers, route to different origins, or respond directly.

**Capability: Global Runtime APIs**:
- `fetch()` — HTTP client
- `Promise` — for wait-on-completion patterns
- `crypto` — Web Crypto API (SHA, AES, HMAC)
- `TextEncoder/TextDecoder`
- No: `fs`, `setTimeout`, `setInterval`, `Worker` (threads)

**Capability: Workers KV** (covered later): Global key-value store with write-through caching at every edge location.

## Practical Focus

Write a minimal Worker in plain JavaScript:

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Log request path
    console.log(`[${url.pathname}]`);
    
    // Example: inspect request
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Proxy everything else to origin
    return fetch(request);
  }
};
```

This is the basic handler pattern. `fetch(request)` proxies the original request to your origin seamlessly.

## Key Takeaway

**Workers are synchronous request handlers constrained by CPU and I/O limits, not by how long they take to start up—design for latency-critical work, not batch jobs.**

## Reading

1. **Cloudflare**: [Workers Runtime API](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) — skim the available APIs (~5 min)
2. **Cloudflare**: [Compatibility Dates (Gradual Rollouts)](https://developers.cloudflare.com/workers/platform/compatibility-dates/) — understand how Cloudflare evolves the runtime (~3 min)

## Bridge to Next Day

Tomorrow: **Installing Wrangler and your first deployment**—we'll go from code to live on a Cloudflare URL.
