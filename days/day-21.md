# Day 21: Week 3 Wrap-up & Observability at the Edge

## Week 3 Recap: Stateful Edge Computing

- **Day 15**: Durable Objects basics (persistent unique objects)
- **Day 16**: Storage & transactions (ACID guarantees)
- **Day 17**: WebSockets (real-time state sync)
- **Day 18**: Locks & coordination (preventing race conditions)
- **Day 19**: SQL queries (complex data operations)
- **Day 20**: Sharding patterns (scaling to millions)
- **Day 21**: Observability foundation

**You now understand the stateful edge**: How to store state durably, sync with clients in real-time, coordinate updates, and scale horizontally with sharding.

## Concepts

**Observability at the Edge**: Traditional logging breaks down. You can't SSH into a Cloudflare datacenter. Instead, you **instrument and aggregate**:

1. **Logs**: Structured events (request, response, error)
2. **Metrics**: Counters (requests), gauges (connections), histograms (latency)
3. **Traces**: Request flow across services

**Basic Logging**: Console logs in Workers/DOs appear in:
- `wrangler dev` output (local)
- `wrangler tail` (live production stream)
- Cloudflare Dashboard → Logs tab

**Structured Logging**: Emit JSON for better querying:
```javascript
console.log(JSON.stringify({
  timestamp: Date.now(),
  userId: 'user123',
  action: 'increment',
  oldValue: 10,
  newValue: 11
}));
```

**Metrics with Analytics Engine**: Cloudflare's built-in time-series database (covered in Week 4).

**External Integration**: Send logs to external services (e.g., Datadog, Sentry) via fetch:
```javascript
await fetch('https://http-intake.logs.datadoghq.com/v1/input', {
  method: 'POST',
  headers: { 'DD-API-KEY': env.DD_API_KEY },
  body: JSON.stringify({ message: 'User logged in', userId })
});
```

## Practical Focus

Add structured logging to a DO:

```javascript
export class ObservedCounter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  log(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      doId: this.state.id.toString(),
      ...event
    };
    console.log(JSON.stringify(entry));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const startTime = Date.now();
    
    try {
      if (url.pathname === '/increment') {
        const current = await this.state.storage.get('count') || 0;
        const newValue = current + 1;
        await this.state.storage.put('count', newValue);
        
        this.log({
          event: 'increment',
          oldValue: current,
          newValue,
          duration: Date.now() - startTime
        });
        
        return new Response(JSON.stringify({ value: newValue }));
      }
    } catch (err) {
      this.log({
        event: 'error',
        error: err.message,
        duration: Date.now() - startTime
      });
      
      return new Response('Error', { status: 500 });
    }
  }
}
```

## Key Takeaway

**Observability at the edge means structured logging and metrics—you can't debug by SSHing in, so instrument everything.**

## Reading

1. **Cloudflare**: [Wrangler Tail](https://developers.cloudflare.com/workers/wrangler/commands/#tail) (~3 min)
2. **Structured Logging**: [Logfmt](https://brandur.org/logfmt) (quick reference ~3 min)

---

## Lab 3: Durable Objects & Real-Time Sync

**Objective**: Build a collaborative counter or shared state system using DOs and WebSockets.

**Deliverables**:
1. A Durable Object that maintains a shared counter
2. WebSocket support for real-time updates to multiple clients
3. Persistent storage (survives DO restart)
4. Test locally with `wrangler dev` and multiple browser tabs

See [`labs/lab-03-durable-objects.md`](../labs/lab-03-durable-objects.md) for full brief.

---

## Bridge to Week 4

Next week: **Week 4: Analytics, Production Patterns & Security**. We'll measure what matters at scale, deploy safely, and secure the edge.
