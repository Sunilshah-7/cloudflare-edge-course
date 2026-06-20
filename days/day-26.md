# Day 26: Secrets Management, TLS & Rate Limiting at Scale

## Concepts

**Secret Rotation**:
1. Never hardcode credentials in code
2. Rotate periodically (quarterly or on team changes)
3. Use Cloudflare Secrets for encryption at rest
4. Audit secret access (logs should record who fetched what)

**TLS/HTTPS**: Cloudflare handles TLS termination. Your Worker sees:
- `request.headers.get('CF-Connecting-IP')` — client IP
- `request.headers.get('CF-TLS-Version')` — TLS version (TLS 1.3 recommended)
- `request.headers.get('CF-TLS-Cipher')` — cipher suite (AEAD recommended)

**Enforce HTTPS Only**: Reject non-HTTPS requests at Workers level:
```javascript
if (new URL(request.url).protocol !== 'https:') {
  return new Response('HTTPS required', { status: 403 });
}
```

**Rate Limiting at Scale**: Use DO sharding to distribute rate-limit state:
```javascript
function getRateLimitShardId(userId, numShards) {
  return userId.charCodeAt(0) % numShards;
}

const shardId = getRateLimitShardId(userId, 100);
const limiter = env.RATE_LIMITER_SHARD.get(`shard:${shardId}`);
const allowed = await limiter.fetch(new Request(url));
```

**Rate Limit Strategies**:
1. **Token Bucket**: Allow N requests per time window
2. **Leaky Bucket**: Smooth bursty traffic
3. **Sliding Window**: Accurate rate calculation

## Practical Focus

Build a production rate limiter with DO sharding:

```javascript
// RateLimiter.js (Durable Object)
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/check') {
      const userId = url.searchParams.get('user_id');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const windowSec = parseInt(url.searchParams.get('window') || '60');
      
      const key = `rate:${userId}`;
      const now = Date.now() / 1000;
      
      try {
        await this.state.storage.transaction(async (txn) => {
          const record = await txn.get(key);
          const [count, windowStart] = record
            ? JSON.parse(record)
            : [0, now];
          
          // Reset if window expired
          if (now - windowStart > windowSec) {
            await txn.put(key, JSON.stringify([1, now]), { expirationTtl: windowSec });
            return true; // Allowed
          }
          
          if (count >= limit) {
            throw new Error('Rate limited');
          }
          
          await txn.put(key, JSON.stringify([count + 1, windowStart]), { expirationTtl: windowSec });
        });
        
        return new Response(JSON.stringify({ allowed: true }));
      } catch (err) {
        return new Response(JSON.stringify({ allowed: false, error: err.message }), { status: 429 });
      }
    }
    
    return new Response('Not found', { status: 404 });
  }
}

// Worker.js
export default {
  async fetch(request, env) {
    const userId = request.headers.get('X-User-ID');
    if (!userId) return new Response('Unauthorized', { status: 401 });
    
    // Shard rate limiter
    const shardId = userId.charCodeAt(0) % 10;
    const limiter = env.RATE_LIMITER.get(`shard:${shardId}`);
    
    const limitResponse = await limiter.fetch(
      new Request(`http://do.internal/check?user_id=${userId}&limit=1000&window=60`)
    );
    
    if (!limitResponse.ok) {
      return new Response('Rate limited', { status: 429 });
    }
    
    return fetch(request);
  }
};
```

## Key Takeaway

**Production rate limiting combines sharded DOs (for distribution) with transaction atomicity (for accuracy)—this scales to millions of users.**

## Reading

1. **Cloudflare**: [Secrets Management](https://developers.cloudflare.com/workers/configuration/secrets/) (~3 min)
2. **Token Bucket Algorithm**: [Wikipedia](https://en.wikipedia.org/wiki/Token_bucket) (~5 min)

## Bridge to Next Day

Tomorrow: **Monitoring, Alerting & Incident Response** in production.
