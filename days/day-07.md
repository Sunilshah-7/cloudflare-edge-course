# Day 7: Rate Limiting, DDoS Protection & Week 1 Wrap-up

## Concepts

**Rate Limiting at the Edge**: Block or throttle requests before they reach your origin. This is **order of magnitude cheaper** than handling surge at the origin.

**Cloudflare's Managed Rules**: Enterprise/Pro plans include DDoS, bot, and rate-limit rules. Free tier has basic protections.

**Custom Rate Limiting in Workers**: Implement sliding-window or token-bucket counters using KV:

```javascript
async function rateLimit(key, limit, window) {
  const count = parseInt(await env.RATE_LIMIT.get(key) || '0');
  if (count >= limit) {
    return false; // Rate limited
  }
  await env.RATE_LIMIT.put(key, (count + 1).toString(), { expirationTtl: window });
  return true;
}
```

**IP-Based vs. User-Based**: Rate limit on `request.headers.get('CF-Connecting-IP')` for IP-based, or extract user ID from auth token for user-based.

**Backpressure**: Return `429 Too Many Requests` with `Retry-After` header to politely throttle clients.

## Practical Focus

Implement per-IP rate limiting for an API endpoint:

```javascript
export default {
  async fetch(request, env) {
    if (!request.url.includes('/api/risky')) {
      return fetch(request);
    }
    
    const ip = request.headers.get('CF-Connecting-IP');
    const key = `ratelimit:${ip}`;
    const limit = 100; // requests per minute
    const window = 60;
    
    const count = parseInt(await env.RATE_LIMIT.get(key) || '0');
    
    if (count >= limit) {
      return new Response('Rate limited', {
        status: 429,
        headers: { 'Retry-After': window.toString() }
      });
    }
    
    await env.RATE_LIMIT.put(key, (count + 1).toString(), { expirationTtl: window });
    
    return fetch(request);
  }
};
```

## Week 1 Recap: Fundamentals

- **Day 1**: Why edge compute matters (latency, resilience)
- **Day 2**: Worker runtime constraints and capabilities
- **Day 3**: Wrangler CLI and deployment
- **Day 4**: Request/response manipulation at the edge
- **Day 5**: KV for distributed caching
- **Day 6**: Caching strategies and cache invalidation
- **Day 7**: Rate limiting and protection

**You now understand the core mental model**: Cloudflare Workers intercept requests globally, let you transform them, cache results, and protect your origin with minimal latency. Tomorrow, we dig deeper into production patterns.

## Key Takeaway

**Rate limiting at the edge is a force multiplier: stop malicious traffic before it crosses the network, not after it hits your database.**

## Reading

1. **Cloudflare**: [Rate Limiting Rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) (~5 min)
2. **Cloudflare**: [DDoS Protection Overview](https://developers.cloudflare.com/ddos-protection/) (~3 min)

## Bridge to Week 2

Tomorrow we enter **Week 2: Middleware, Performance & Patterns**. We'll build production middleware, debug Workers, and optimize for latency and cost.
