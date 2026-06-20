# Day 4: Headers, Cookies & Request Transformation

## Concepts

**Headers as Metadata**: HTTP headers let you pass structured data without modifying the request body. Cloudflare Workers let you **read, add, remove, and modify** headers at the edge before proxying to origin—or before responding directly.

**Request Headers**: Incoming headers are accessible via `request.headers`. Common patterns:
- `User-Agent` — detect mobile, bot, browser
- `Accept-Language` — geo-preference
- `Cookie` — session/auth tokens
- `X-*` (custom headers) — integrations

**Response Headers**: Set via `new Response(body, { headers: { ... } })`. Critical headers:
- `Cache-Control` — controls browser & CDN caching
- `Set-Cookie` — session tokens (replaces on client)
- `Content-Type`
- `X-Custom-*` — pass data back to client or origin

**Modified Requests**: Forward a request with new headers:
```javascript
request.headers.set('X-Forwarded-By', 'cloudflare-worker');
const response = await fetch(request);
```

**Cookies**: Access via `request.headers` as a single `Cookie` string. Parse manually or use a helper. Cloudflare **does not** expose a cookie jar API.

## Practical Focus

Write a Worker that:
1. Reads the `User-Agent` header
2. Adds a custom header `X-Edge-Location` with the Cloudflare colo (available via `request.cf`)
3. Routes mobile traffic to a different origin:

```javascript
export default {
  async fetch(request) {
    const ua = request.headers.get('User-Agent') || '';
    const isMobile = /mobile|android/i.test(ua);
    
    const originUrl = isMobile ? 'https://mobile.example.com' : 'https://www.example.com';
    const url = new URL(request.url);
    url.host = originUrl.split('//')[1];
    
    const newRequest = new Request(url, request);
    newRequest.headers.set('X-Forwarded-By', 'edge-worker');
    newRequest.headers.set('X-Is-Mobile', isMobile ? 'true' : 'false');
    
    const response = await fetch(newRequest);
    response.headers.set('X-Edge-Cached', 'true');
    return response;
  }
};
```

## Key Takeaway

**Headers are your primary tool for request manipulation at the edge—they let you route, transform, and cache without touching the request body.**

## Reading

1. **Cloudflare**: [Request Object](https://developers.cloudflare.com/workers/runtime-apis/web/request/) (~5 min)
2. **Cloudflare**: [The cf Object](https://developers.cloudflare.com/workers/runtime-apis/web/request/#incomingrequestcfproperties) — geo, device, TLS info (~3 min)

## Bridge to Next Day

Tomorrow: **Workers KV—Global Key-Value Store**. We'll cache at the edge, not just pass through.
