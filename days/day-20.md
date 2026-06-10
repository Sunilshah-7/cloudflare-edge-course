# Day 20: Sharding & Scaling Patterns

## Concepts

**The DO Scaling Problem**: Each DO is strongly consistent for its ID, but has limits:
- ~10k concurrent connections per DO
- ~1000 req/sec per DO (sustained)
- 1 GB storage per DO

If you have 1M users and each needs state, you can't have 1M concurrent connections to a single "user" DO.

**Sharding Solution**: Split users into buckets. Instead of one "UserCounter" DO, have 1000 distinct DOs:
```javascript
const userId = request.headers.get('X-User-ID');
const shardKey = `user:${parseInt(userId) % 1000}`; // 0-999
const shard = env.USER_SHARD.get(shardKey);
```

**Deterministic Hashing**: Use consistent hashing so the same user always goes to the same shard:
```javascript
function getShardId(userId, numShards) {
  const hash = Array.from(userId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return hash % numShards;
}
```

**Dynamic Sharding**: Start with few shards and add more as needed. Rebalancing is complex (redistribute existing data), so choose shard count conservatively.

**Namespace per Shard** (optional): Instead of 1 namespace with 1000 IDs, use 1000 namespaces with 1 ID each. Slightly simpler operationally, but requires more config.

## Practical Focus

Build a sharded user state system:

```javascript
export default {
  async fetch(request, env) {
    const userId = request.headers.get('X-User-ID');
    
    // Consistent hash to shard
    const shardId = getShardId(userId, 100); // 100 shards
    const shardKey = `user:${shardId}:${userId}`;
    
    const shard = env.USER_STATE.get(shardKey);
    
    // All operations on this user go to same shard
    const response = await shard.fetch(
      new Request(`http://do.internal/set-preference?key=theme&value=dark`)
    );
    
    return response;
  }
};

function getShardId(userId, numShards) {
  const hash = Array.from(userId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return hash % numShards;
}
```

**Monitoring**: Track:
- Shard distribution (users per shard)
- Request volume per shard (identify hot shards)
- CPU time per shard (identify slow operations)

Rebalance or add shards if imbalance is severe.

## Key Takeaway

**Sharding is how you scale DOs to millions of entities—one shard per logical entity (user, room, document), not one DO for all.**

## Reading

1. **Cloudflare**: [Durable Objects Scaling Patterns](https://developers.cloudflare.com/durable-objects/best-practices/durable-objects/) (~7 min)
2. **Consistent Hashing**: [Hash Ring](https://en.wikipedia.org/wiki/Consistent_hashing) (skim ~5 min)

## Bridge to Next Day

Tomorrow: **Week 3 Wrap & Analytics at the Edge**—measuring what matters.
