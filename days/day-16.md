# Day 16: Durable Object Storage & Transactions

## Concepts

**Storage Backends**:
1. **In-Memory**: Data lost on DO restart (keep-alive timeout ~60s). Fast, good for caches.
2. **SQLite (Persistent)**: Transactional, survives restarts. 1 GB quota per DO.

**Storage API**:
```javascript
await this.state.storage.put('key', value); // Set
await this.state.storage.get('key'); // Get
await this.state.storage.delete('key'); // Delete
await this.state.storage.list(); // Enumerate keys
await this.state.storage.deleteAll(); // Nuke
```

**Transactions**: `storage.transaction()` ensures ACID semantics:
```javascript
await this.state.storage.transaction(async (txn) => {
  const balance = await txn.get('balance');
  if (balance < 10) throw new Error('Insufficient funds');
  await txn.put('balance', balance - 10);
  // Commits if no error
});
```

**SQL Access** (Enterprise+): Direct SQL queries on the SQLite store:
```javascript
const result = await this.state.storage.sql.exec(
  'SELECT * FROM users WHERE id = ?',
  [userId]
);
```

**Caveats**:
- Storage is **per-DO ID**, not per-Worker request
- Writes are **durable** but can take seconds to replicate to backup locations
- **Quota**: 1 GB per DO. Plan storage carefully

## Practical Focus

Build a rate limiter using DO storage & transactions:

```javascript
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/check') {
      const userId = url.searchParams.get('user_id');
      const limit = 100;
      const window = 60; // seconds
      
      try {
        await this.state.storage.transaction(async (txn) => {
          let count = await txn.get(`rate:${userId}`) || 0;
          if (count >= limit) {
            throw new Error('Rate limit exceeded');
          }
          
          // Increment and set expiration
          await txn.put(`rate:${userId}`, count + 1);
          
          // On first use, set TTL
          if (count === 0) {
            // SQLite can handle TTL; check docs for exact pattern
            // Or use a separate key for expiration timestamps
          }
        });
        
        return new Response('OK', { status: 200 });
      } catch (err) {
        return new Response('Rate limited', { status: 429 });
      }
    }
    
    return new Response('Not found', { status: 404 });
  }
}
```

## Key Takeaway

**Transactions guarantee atomicity at the edge—your rate limiter won't double-count, your balance won't go negative from concurrent requests.**

## Reading

1. **Cloudflare**: [Storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/) (~7 min)
2. **Cloudflare**: [Transactions](https://developers.cloudflare.com/durable-objects/platform/transactions/) (~5 min)

## Bridge to Next Day

Tomorrow: **WebSockets & Real-Time State Sync**—persistent connections from edge to client.
