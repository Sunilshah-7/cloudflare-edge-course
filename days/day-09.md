# Day 9: JWT Authentication & OAuth Flows at the Edge

## Concepts

**JWT (JSON Web Tokens)**: Stateless, self-contained credentials. Signed payload (`header.payload.signature`) that the edge can verify without hitting a database.

**JWT Verification at the Edge**:
1. Client sends `Authorization: Bearer <token>` 
2. Edge extracts and verifies signature using JWKS (public keys)
3. Extracts claims (user ID, permissions)
4. Proxies request with `X-User-ID` header

**No Secret Storage in Workers**: You can't securely store private keys in code. Use `env` (Wrangler secrets) to inject public keys or JWKS URLs.

**OAuth Delegation**: Many integrations (GitHub, Google, Okta) issue OAuth tokens. Edge verifies these via their JWKS endpoint:

```javascript
async function fetchJWKS(jwksUrl) {
  const cached = await env.JWKS_CACHE.get(jwksUrl);
  if (cached) return JSON.parse(cached);
  
  const resp = await fetch(jwksUrl);
  const keys = await resp.json();
  await env.JWKS_CACHE.put(jwksUrl, JSON.stringify(keys), { expirationTtl: 3600 });
  return keys;
}
```

**Authorization**: After verifying identity, check permissions (roles, scopes) from JWT claims:
```
iss: "https://oauth.example.com"
aud: "api.example.com"
sub: "user123"
scope: "read write admin"
```

## Practical Focus

Implement a middleware that validates JWT and attaches user to context:

```javascript
async function verifyJWT(token, jwksUrl, env) {
  const [header, payload, signature] = token.split('.');
  const decoded = JSON.parse(atob(payload));
  
  const jwks = await fetchJWKS(jwksUrl, env);
  const key = jwks.keys.find(k => k.kid === JSON.parse(atob(header)).kid);
  
  // In production, use a JWT library (jose, jsonwebtoken)
  // This is simplified; signature verification is trivial only with careful crypto
  return decoded;
}

export default {
  async fetch(request, env) {
    const auth = request.headers.get('Authorization');
    if (!auth) return new Response('Unauthorized', { status: 401 });
    
    const token = auth.replace('Bearer ', '');
    const user = await verifyJWT(token, env.JWKS_URL, env);
    
    request.headers.set('X-User-ID', user.sub);
    request.headers.set('X-User-Scope', user.scope);
    
    return fetch(request);
  }
};
```

## Key Takeaway

**JWTs let you verify identity and permissions at the edge without round-tripping to an auth server—critical for low-latency APIs.**

## Reading

1. **Cloudflare**: [JWT Example](https://developers.cloudflare.com/workers/examples/authentication/) (~5 min)
2. **Auth0**: [JWT.io](https://jwt.io/) — understand structure and tools (~5 min)

## Bridge to Next Day

Tomorrow: **Secrets Management & Environment Variables**—how to safely inject passwords, keys, and credentials.
