# Lab 2: Middleware Chain & JWT Auth

**Objective**: Build a middleware-based API gateway with JWT authentication, CORS, and logging.

**Time**: 60–90 min

**Prerequisites**: Lab 1 completed, understand JWT basics

---

## Setup

Continue from Lab 1 or create new project:
```bash
wrangler init middleware-auth
```

Add a test JWT library:
```bash
npm install jose  # JWT signing/verification
```

---

## Part 1: Middleware Framework

Create `src/middleware.js`:

```javascript
export async function compose(middlewares, handler) {
  return async (request, env, ctx) => {
    let index = -1;
    
    async function dispatch(i) {
      if (i <= index) return; // Prevent duplicate calls
      index = i;
      
      const mw = middlewares[i];
      if (!mw) return handler(request, env, ctx);
      
      return mw(request, env, ctx, () => dispatch(i + 1));
    }
    
    return dispatch(0);
  };
}

export const cors = (allowOrigin = '*') => async (request, env, ctx, next) => {
  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
      }
    });
  }
  
  const response = await next();
  response.headers.set('Access-Control-Allow-Origin', allowOrigin);
  return response;
};

export const logging = async (request, env, ctx, next) => {
  const start = Date.now();
  console.log(`→ ${request.method} ${new URL(request.url).pathname}`);
  
  const response = await next();
  const duration = Date.now() - start;
  console.log(`← ${response.status} (${duration}ms)`);
  
  return response;
};

export const auth = (jwksUrl, audience) => async (request, env, ctx, next) => {
  // Skip auth for public routes
  if (request.url.includes('/health')) {
    return next();
  }
  
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    // In production, use `jose` to verify JWT properly
    // For now, assume token is valid and extract claims
    const [header, payload, sig] = token.split('.');
    const claims = JSON.parse(atob(payload));
    
    // Attach to request for handler
    request.user = claims;
    return next();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

---

## Part 2: Handler

Create `src/handler.js`:

```javascript
export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ ok: true }));
  }
  
  if (url.pathname === '/me') {
    return new Response(JSON.stringify({
      user: request.user,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (url.pathname === '/api/protected') {
    const userId = request.user?.sub;
    return new Response(JSON.stringify({
      message: `Hello ${userId}!`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Not found', { status: 404 });
}
```

---

## Part 3: Main Worker

Update `src/index.js`:

```javascript
import { compose, cors, logging, auth } from './middleware.js';
import { handleRequest } from './handler.js';

const middlewares = [
  cors('*'),
  logging,
  auth('https://your-jwks-url.com', 'your-audience')
];

const handler = compose(middlewares, handleRequest);

export default {
  fetch: handler
};
```

---

## Part 4: Testing

**Local dev**:
```bash
wrangler dev
```

**Test public endpoint**:
```bash
curl http://localhost:8787/health
# Output: {"ok":true}
```

**Test protected endpoint without token**:
```bash
curl http://localhost:8787/api/protected
# Output: {"error":"Missing token"}
# Status: 401
```

**Test with mock token**:
```bash
# Create a test JWT (header.payload.sig)
# payload: {"sub":"user123","aud":"your-audience"}
MOCK_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiYXVkIjoieW91ci1hdWRpZW5jZSJ9.signature"

curl -H "Authorization: Bearer $MOCK_TOKEN" http://localhost:8787/api/protected
# Output: {"message":"Hello user123!"}
```

**Test CORS**:
```bash
curl -H "Origin: https://example.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     http://localhost:8787/api/protected

# Should return 204 with CORS headers
```

---

## Part 5: Challenge

1. **Add a rate-limiter middleware** that limits requests to 10 per minute (per IP).
2. **Add request validation**: Check that POST /api/protected has a JSON body.
3. **Use a real JWT library** (`jose`) to verify tokens properly.

---

## Deliverables

- [ ] Middleware chain working (can add/remove/reorder)
- [ ] CORS preflight working
- [ ] JWT auth protecting /api/protected
- [ ] Logging visible in console
- [ ] Tests pass locally

---

## Reference

- **Middleware Pattern**: https://expressjs.com/ (Node.js example)
- **JWT**: https://jwt.io/
- **jose (JWT lib)**: https://github.com/panva/jose
