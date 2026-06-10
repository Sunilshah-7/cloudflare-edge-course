# Day 15: Durable Objects Basics — Architecture & API

## Concepts

**What's a Durable Object?**: A unique, persistent JavaScript object running on Cloudflare's network. Each DO:
- Has a globally unique **ID** (string)
- Holds **mutable state** (in-memory + persistent SQLite store)
- Processes **requests/fetches** from Workers
- Provides **strong consistency** for that ID

**Global Uniqueness**: All requests for a DO with ID `xyz` route to the same physical location (usually closest to first accessor). This ensures serialized, consistent access to that ID's state.

**Access Patterns**:
1. **RPC (Fetch)**: Worker calls DO via HTTP-like interface:
   ```javascript
   const stub = env.MY_DO.get(doId);
   const response = await stub.fetch(new Request('http://do.internal/method'));
   ```

2. **WebSocket**: Useful for real-time sync, multiplayer:
   ```javascript
   const ws = await stub.connect();
   ws.send(JSON.stringify({ action: 'move', x: 10, y: 20 }));
   ```

**Scope**: DOs are scoped per namespace. When you define a DO class, you deploy it. Workers reference it via `env.NAMESPACE_NAME`.

**Pricing**: You pay for:
- **Requests handled** (per 100k)
- **Duration** (milliseconds CPU)
- **Storage** (per GB-month)

Much cheaper than a traditional server for bursty, low-volume workloads.

## Practical Focus

Build a minimal Durable Object:

**wrangler.toml**:
```toml
[[durable_objects.bindings]]
name = "COUNTER"
class_name = "Counter"
script_name = "my-worker"

[durable_objects]
migrations = [
  {tag = "v1", new = ["Counter"]}
]
```

**src/counter.js** (Durable Object):
```javascript
export class Counter {
  constructor(state, env) {
    this.state = state; // Persistent storage (SQLite)
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/get') {
      const count = await this.state.storage.get('count') || 0;
      return new Response(count.toString());
    }
    
    if (url.pathname === '/increment') {
      const current = await this.state.storage.get('count') || 0;
      await this.state.storage.put('count', current + 1);
      return new Response((current + 1).toString());
    }
    
    return new Response('Not found', { status: 404 });
  }
}
```

**src/index.js** (Worker):
```javascript
export default {
  async fetch(request, env) {
    const counterId = 'user-123'; // Unique ID
    const counter = env.COUNTER.get(counterId);
    return await counter.fetch(request.url);
  }
};
```

## Key Takeaway

**Durable Objects are the edge's answer to state: each ID gets a unique, persistent, strongly-consistent home—use them for anything requiring coordination.**

## Reading

1. **Cloudflare**: [Durable Objects API](https://developers.cloudflare.com/durable-objects/api/) (~7 min)
2. **Cloudflare**: [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/#pricing) (~2 min)

## Bridge to Next Day

Tomorrow: **Durable Object Storage & Transactions**—how to persist state durably and atomically.
