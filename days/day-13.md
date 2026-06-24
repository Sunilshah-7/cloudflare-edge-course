# Day 13: Error Handling & Resilience

## Concepts

**Graceful Degradation**: When origin is down or slow, serve cached content or a fallback. This is the "edge as a buffer" pattern.

**Stale-on-Error**: Serve stale cached content if origin fetch fails:
```javascript
let response = await cache.match(request);
if (response) {
  response = new Response(response.body, response);
  response.headers.append('X-Cache-Status', 'HIT-STALE');
  return response; // Serve stale before trying origin
}

try {
  const originResponse = await fetch(originRequest);
  await cache.put(request.clone(), originResponse.clone());
  return originResponse;
} catch (err) {
  // Origin fetch failed; serve stale or error
  return new Response('Service temporarily unavailable', { status: 503 });
}
```

**Circuit Breaker**: Track origin failures. If error rate exceeds threshold, stop trying:
```javascript
async function fetchWithCircuitBreaker(request, env) {
  const failCount = await env.CIRCUIT_BREAKER.get('failure-count') || '0';
  if (parseInt(failCount) > 10) {
    return new Response('Origin is down', { status: 503 });
  }
  
  try {
    return await fetch(request);
  } catch (err) {
    await env.CIRCUIT_BREAKER.put('failure-count', (parseInt(failCount) + 1).toString(), { expirationTtl: 60 });
    throw err;
  }
}
```

**Fallback Responses**: Non-critical endpoints can return synthetic data or empty results:
```javascript
if (url.pathname === '/api/recommendations') {
  // Non-critical; fallback to empty
  return new Response(JSON.stringify([]), { status: 200 });
}
```

## Practical Focus

Build a resilient API proxy:

```javascript
export default {
  async fetch(request, env) {
    const cacheKey = new Request(request.url, { method: 'GET' });
    const cache = caches.default;
    
    // 1. Check cache first
    let response = await cache.match(cacheKey);
    if (response) return response;
    
    // 2. Try to fetch origin
    try {
      const originResponse = await Promise.race([
        fetch(request),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        ),
      ]);
      
      if (originResponse.ok) {
        await cache.put(cacheKey, originResponse.clone());
        return originResponse;
      }
    } catch (err) {
      console.error('Origin fetch failed:', err.message);
    }
    
    // 3. Fallback
    return new Response('Service unavailable (origin down)', { status: 503 });
  }
};
```

## Key Takeaway

**Resilience at the edge means anticipating origin failure and having fallbacks—cache is your safety net, not your primary path.**

## Reading

1. **Cloudflare**: [Errors and exceptions](https://developers.cloudflare.com/workers/observability/errors/) (~5 min)
2. **Martin Fowler**: [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html) (~10 min, skim)

## Bridge to Next Day

Tomorrow: **Week 2 Wrap & Introduction to Durable Objects**—stateful compute at the edge.
