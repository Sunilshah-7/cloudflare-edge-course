# Day 6: Caching Strategies—HTTP Cache-Control & Surrogate Keys

## Concepts

**HTTP Caching**: Controlled via `Cache-Control` header. Browsers cache with `max-age`, Cloudflare's edge caches with `s-maxage`:
```
Cache-Control: public, max-age=3600, s-maxage=86400
```
Browser: 1 hour. Cloudflare (surrogate): 24 hours.

**Cache By Default**: Cloudflare caches cacheable responses (200, 301, 404 with long TTLs). But many responses are uncacheable (Set-Cookie, Authorization). Use `Cache-Everything` page rule or manual cache control in Workers.

**Surrogate Keys**: Tag cached responses so you can purge by tag, not by URL. Perfect for invalidating related content:
```javascript
response.headers.append('Cache-Tag', 'product:123,product-list');
```

Then purge via API: `curl -X POST ... -d '{"files":[],"tags":["product:123"]}'`

**Cache-Aside Pattern**:
```
if (in KV) return cached
if (in HTTP cache) return cached
fetch origin → cache in KV → cache in HTTP → return
```

**Stale-While-Revalidate**: Serve stale content for X seconds while fetching fresh in the background:
```
Cache-Control: max-age=60, stale-while-revalidate=600
```

Browser serves stale for 10 min, revalidates in background.

## Practical Focus

Build a cached API response with surrogate keys:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Cache GET /api/products
    if (url.pathname === '/api/products' && request.method === 'GET') {
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const cache = caches.default;
      
      let response = await cache.match(cacheKey);
      if (response) return response;
      
      // Cache miss: fetch & cache
      const originResponse = await fetch(`https://api.example.com${url.pathname}`);
      const body = await originResponse.json();
      
      response = new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300, s-maxage=3600',
          'Cache-Tag': 'products,api'
        }
      });
      
      await cache.put(cacheKey, response.clone());
      return response;
    }
    
    return fetch(request);
  }
};
```

## Key Takeaway

**Caching at the edge is a multiplier: one cache hit prevents thousands of origin requests. Use surrogate keys to keep caches fresh without sledgehammer purges.**

## Reading

1. **Cloudflare**: [Cache Control](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) (~5 min)
2. **Cloudflare**: [Cache Purge by Tag](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/) (~3 min)

## Bridge to Next Day

Tomorrow: **Rate Limiting & DDoS Protection at the Edge**. We'll throttle requests before they hit your origin.
