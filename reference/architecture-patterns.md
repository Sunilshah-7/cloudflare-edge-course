# Architecture Patterns for Edge Computing

This guide covers common patterns for building scalable, resilient edge applications.

---

## 1. Stateless API Gateway

**Pattern**: Intercept requests, validate, transform, route.

**When to use**:
- Public APIs that need auth
- Request routing (route to different origins based on path/header)
- Rate limiting & throttling
- Request/response transformation

**Example**:
```
Client → Edge (Worker)
         ├─ Validate JWT
         ├─ Rate limit check
         ├─ Route to origin A or B
         └─ Proxy request
         → Origin
         ← Response
         → Cache response
         → Client
```

**Pros**:
- Simple, stateless, fast
- No persistent connections needed
- Horizontally scalable (infinite concurrent requests)

**Cons**:
- Can't maintain state across requests
- Limited by ~30s CPU timeout

**Reference**: Day 8–14

---

## 2. Cache-Aside Pattern

**Pattern**: Check cache → miss → fetch & cache → return

**When to use**:
- Read-heavy workloads (product catalogs, configs)
- Origin is expensive (database queries)
- Acceptable stale data (hours, not seconds)

**Example**:
```
Client → Edge (HTTP Cache or KV)
         ├─ Hit → return (< 5ms latency)
         └─ Miss → fetch origin → cache → return (100ms+ latency)
         → Origin or Third-party API
```

**Pros**:
- Only scales origin as needed (cache absorbs traffic)
- Very low latency for hits
- Simple to implement

**Cons**:
- Stale data possible (cache TTL balancing act)
- Cache warming required for performance
- Thundering herd (many cache misses simultaneously)

**Reference**: Day 5–6

---

## 3. Sharded Durable Objects

**Pattern**: Partition state across many DOs by ID.

**When to use**:
- Per-user or per-session state (millions of users)
- Rate limiting (per-user accuracy)
- Collaborative features (one room = one DO)
- Real-time sync (need persistent connections)

**Example**:
```
Client → Edge (Worker)
         ├─ Extract user ID
         ├─ Compute shard ID (hash % num_shards)
         └─ Route to DO[shard_id]
         → Durable Object
            ├─ Consistent state per user
            ├─ Persistent storage
            └─ WebSocket broadcast
         ← Real-time updates → All clients
```

**Pros**:
- Millions of DOs (one per entity)
- Strong consistency per entity
- Persistent storage built-in
- Real-time WebSocket support

**Cons**:
- More expensive than KV ($0.15–$1.25 vs $0.50–$5)
- Can't easily aggregate across shards
- Moderate complexity (routing, sharding logic)

**Reference**: Day 15–21

---

## 4. Hybrid (Edge + Origin)

**Pattern**: Edge handles latency-sensitive ops, origin handles complex logic.

**When to use**:
- Mixed workloads (some cacheable, some complex)
- Security-sensitive ops (payment processing on origin)
- Transactions (ACID guarantees needed)

**Example**:
```
Client → Edge (Worker)
         ├─ Check cache (product catalog)
         ├─ Validate JWT
         ├─ Rate limit
         └─ Route to origin for complex logic
         → Origin
            ├─ Query database
            ├─ Complex business logic
            └─ Update state
         ← Response
         → Cache if appropriate
         → Client
```

**Pros**:
- Best of both worlds (performance + correctness)
- Familiar pattern (most teams understand)
- Clear separation of concerns

**Cons**:
- Complexity (need to reason about edge + origin)
- Origin is still a bottleneck
- Higher latency than edge-only

**Reference**: Day 12–14, 24

---

## 5. Circuit Breaker (Resilience)

**Pattern**: Monitor origin health; stop calling if failing.

**When to use**:
- Protecting origin from cascade failures
- Graceful degradation (serve cache when origin down)
- Auto-recovery (retry after cool-off)

**Example**:
```
Client → Edge (Worker)
         ├─ Check circuit state (open/closed/half-open)
         └─ If closed, fetch origin
            ├─ Success → move to closed
            └─ Failure → increment counter
         ├─ If open, serve cache or fallback
         └─ Half-open: try origin, decide
         → Response (or cache/fallback)
         → Client
```

**Implementation**:
```javascript
// Simple state: track failures in KV
const failureCount = await env.KV.get('origin-failures') || '0';
if (parseInt(failureCount) > 5) {
  // Circuit open: serve cache
  return cache.match(request) || fallback();
}

try {
  const resp = await fetch(originRequest);
  await env.KV.put('origin-failures', '0'); // Reset
  return resp;
} catch (err) {
  const count = parseInt(failureCount) + 1;
  await env.KV.put('origin-failures', count.toString());
  return fallback();
}
```

**Pros**:
- Prevents cascade (stops hammering failing service)
- Automatic recovery
- Simple to implement

**Cons**:
- Course-grained (whole origin, not per-endpoint)
- Need to define thresholds (failures to trigger open)

**Reference**: Day 13

---

## 6. Canary Release

**Pattern**: Route small percentage of traffic to new version.

**When to use**:
- Safe rollout of new code
- A/B testing
- Gradual traffic shift

**Example**:
```
Client → Edge (Worker)
         ├─ Generate random 0–100
         ├─ If < 10 → route to v2
         └─ Else → route to v1
         → Origin v1 or v2
         ← Response
         → Monitor metrics
         → If good, gradually increase % to v2
```

**Implementation**:
```javascript
const canaryPercent = env.CANARY_PERCENT || 5;
const isCanary = Math.random() * 100 < canaryPercent;

const originUrl = isCanary
  ? 'https://api-v2.example.com'
  : 'https://api-v1.example.com';

const url = new URL(request.url);
url.host = originUrl.split('//')[1];

return fetch(new Request(url, request));
```

**Pros**:
- Low risk (catch issues in small % of traffic)
- Easy to revert (100% back to v1)
- Real-world testing (not just staging)

**Cons**:
- Monitoring is critical (need to detect issues)
- Asymmetric load (v1 handles 90%, v2 10%)

**Reference**: Day 24

---

## 7. Rate Limiting Per-User

**Pattern**: Track request count per-user using DOs.

**When to use**:
- API quota enforcement
- Preventing abuse (single user can't hammer)
- Fair resource allocation

**Example** (using DO):
```
Client → Worker
         ├─ Extract user ID
         ├─ Hash to shard ID
         └─ Ask shard DO: allowed?
         → DO (rate-limiter)
            ├─ Check counter for user
            ├─ If < limit → increment, allow
            └─ Else → reject
         ← 200 or 429 response
         → Client
```

**Pros**:
- Atomic (don't double-count)
- Distributes across shards (scales)
- Persists (no loss on edge restart)

**Cons**:
- More expensive than KV
- One DO per shard (need N shards)

**Reference**: Day 18, 26

---

## 8. Collaborative State (WebSocket + DO)

**Pattern**: Persistent connection from client to DO for real-time sync.

**When to use**:
- Collaborative editing
- Real-time games or multiplayer
- Live notifications
- Chat

**Example**:
```
Client ─── WebSocket ─→ Durable Object
                        ├─ Stores state
                        ├─ Broadcasts to all clients
                        └─ Persists changes
     ←━━━ Updates ━━━─
```

**Pros**:
- True real-time (subsecond latency)
- Strong consistency (one DO is source of truth)
- Persistent state

**Cons**:
- More expensive per connection
- Limited to ~10k concurrent per DO
- Need sharding for millions of rooms

**Reference**: Day 17–21

---

## Choosing a Pattern

| Workload | Pattern | Why |
|---|---|---|
| Static files, images | HTTP cache | Trivial, free |
| Product catalog | Cache-aside | Read-heavy, tolerate stale |
| User sessions | Sharded DO + WebSocket | Need consistency, real-time |
| Public API | Stateless gateway | Simple, scalable |
| Payment processing | Hybrid (origin) | Need ACID, security |
| Multiplayer game | Sharded DO + WebSocket | Real-time, consistent |
| Config flags | KV | Read-heavy, occasional writes |
| Rate limiter | Sharded DO | Need accuracy |
| Complex reports | Origin database | Intensive queries |
| Mobile API | Hybrid (cache + origin) | Mix of cacheable & dynamic |

---

## Hybrid Multi-Pattern Example

**Real-world e-commerce**:
```
Product Catalog    → HTTP cache (static, long TTL)
Feature flags      → KV (read-heavy)
Shopping cart      → Sharded DO (per-user, persistent)
Checkout           → Origin (complex, PCI-compliant)
Rate limiting      → Sharded DO (per-user accuracy)
Recommendations    → Cache-aside from A/B test service
Monitoring         → Analytics Engine
```

---

## References

- **Cloudflare Docs**: https://developers.cloudflare.com/
- **Martin Fowler**: https://martinfowler.com/bliki/ (various patterns)
- **CQRS Pattern**: https://martinfowler.com/bliki/CQRS.html
- **Event Sourcing**: https://martinfowler.com/eaaDev/EventSourcing.html
