# Day 18: Locks, Coordination & Consensus at the Edge

## Concepts

**The Coordination Problem**: Multiple Workers or clients can call the same DO simultaneously. Without coordination, you get race conditions:

```
Worker A: read(balance) → 100
Worker B: read(balance) → 100
Worker A: write(balance, 90) → success
Worker B: write(balance, 110) → success (overwrites A!)
```

**Transactions Fix Most**: `storage.transaction()` serializes updates. But some operations need **distributed locks**—preventing concurrent access across multiple DO instances or preventing thundering herd issues.

**Distributed Lock Pattern**:
```javascript
async function acquireLock(lockName, timeout = 5000) {
  const lockKey = `lock:${lockName}`;
  const lockValue = Date.now();
  
  while (true) {
    const existing = await this.state.storage.get(lockKey);
    if (!existing || existing < Date.now()) {
      // Lock is free; claim it
      await this.state.storage.put(lockKey, Date.now() + timeout);
      return true;
    }
    
    // Lock held; back off and retry
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
  }
}

async function releaseLock(lockName) {
  await this.state.storage.delete(`lock:${lockName}`);
}
```

**Consensus Problem**: Suppose you have multiple DOs representing replicas of a counter. How do they stay in sync? This is **consensus**—a hard problem outside a single DO.

**Rule of Thumb**: Design so one DO is the source of truth. If you need consensus, prefer:
1. **Single DO** with sharding (one counter per user, many users)
2. **Durable Objects + a database** (DO caches, DB is source of truth)

## Practical Focus

Build a queue processor with locks:

```javascript
export class Queue {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/enqueue') {
      const item = url.searchParams.get('item');
      const queue = (await this.state.storage.get('queue') || []);
      queue.push(item);
      await this.state.storage.put('queue', queue);
      return new Response('Enqueued');
    }
    
    if (url.pathname === '/process') {
      const lockKey = 'processing-lock';
      const isLocked = await this.state.storage.get(lockKey);
      
      if (isLocked) {
        return new Response('Already processing', { status: 409 });
      }
      
      await this.state.storage.put(lockKey, Date.now() + 30000);
      
      try {
        const queue = (await this.state.storage.get('queue') || []);
        if (queue.length === 0) return new Response('Queue empty');
        
        const item = queue.shift();
        await this.state.storage.put('queue', queue);
        
        // Process item (e.g., send to external service)
        await this.env.QUEUE_HANDLER.fetch(
          new Request('http://handler.internal', {
            method: 'POST',
            body: JSON.stringify(item)
          })
        );
        
        return new Response('Processed');
      } finally {
        await this.state.storage.delete(lockKey);
      }
    }
    
    return new Response('Not found', { status: 404 });
  }
}
```

## Key Takeaway

**Locks at the edge prevent race conditions, but the simplest design is one DO per resource—avoid distributed consensus if possible.**

## Reading

1. **Cloudflare**: [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (~3 min)
2. **Distributed Systems**: [Consensus Explained](https://en.wikipedia.org/wiki/Consensus_(computer_science)) (skim for context ~5 min)

## Bridge to Next Day

Tomorrow: **SQL Support & Scaling Durable Objects Patterns**.
