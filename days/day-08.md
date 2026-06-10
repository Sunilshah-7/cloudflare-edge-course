# Day 8: Middleware & Request Chains

## Concepts

**Middleware Pattern**: Decompose request handling into reusable, chain-able functions. Each middleware either:
- Transforms the request and passes it on
- Transforms the response
- Responds directly (e.g., error, rate limit)

**Middleware Chain**: Requests flow through middleware like Unix pipes. Cloudflare Workers doesn't have built-in middleware, but you can compose functions:

```javascript
const middleware = [
  authMiddleware,
  rateLimitMiddleware,
  loggingMiddleware
];

async function chain(request, middlewares) {
  for (const mw of middlewares) {
    const result = await mw(request);
    if (result instanceof Response) return result; // Middleware responded
    request = result; // Middleware transformed request, continue
  }
  return await fetch(request);
}
```

**Common Middleware**:
- **Auth**: Validate JWT, extract user ID, pass in header
- **CORS**: Add/check CORS headers
- **Logging**: Log request details to external service
- **Compression**: Gzip responses
- **Route**: Switch logic based on path

## Practical Focus

Build a middleware chain:

```javascript
async function withAuth(request) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return new Response('Unauthorized', { status: 401 });
  
  const user = await verifyJWT(token); // Your logic
  request.user = user; // Attach to request
  return request;
}

async function withCORS(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT',
      }
    });
  }
  return request;
}

export default {
  async fetch(request, env) {
    // Chain middlewares
    for (const mw of [withCORS, withAuth]) {
      const result = await mw(request);
      if (result instanceof Response) return result;
      request = result;
    }
    
    return fetch(request);
  }
};
```

## Key Takeaway

**Middleware chains separate concerns and make Workers code composable, testable, and maintainable—build them early.**

## Reading

1. **Cloudflare**: [Examples: Middleware](https://developers.cloudflare.com/workers/examples/middleware-chain/) (~5 min)
2. **Hono (Meta-Framework for Workers)**: [Middleware](https://hono.dev/docs/guides/middleware) — see how frameworks abstract this (~3 min)

## Bridge to Next Day

Tomorrow: **JWTs, OAuth, and Auth at the Edge**—implement production authentication without a login server.
