# Day 28: Edge Architecture Patterns & Decision Framework

## Concepts

**Pattern 1: Stateless API Gateway**
- Workers intercept requests
- Validate, transform, route
- No state required
- **Best for**: Auth, throttling, caching, routing
- **Example**: JWT validation proxy

**Pattern 2: Cache-Aside with Fallback**
- Check cache (HTTP, KV)
- On miss, fetch origin
- Cache result, return
- On origin failure, serve stale
- **Best for**: Read-heavy APIs, product catalogs
- **Example**: Product listing API

**Pattern 3: Sharded Durable Objects**
- Many DOs partitioned by ID (user, room, document)
- Each DO holds state + coordinates
- Workers route to appropriate shard
- **Best for**: Real-time collaboration, sessions, rate limiting
- **Example**: Multiplayer editor

**Pattern 4: Hybrid (Edge + Origin)**
- Edge handles latency-sensitive ops (cache, auth)
- Origin handles complex queries, side effects
- Workers trigger origin via fetch, wait for result
- **Best for**: Mixed workloads
- **Example**: E-commerce (cart on edge, checkout on origin)

**Decision Framework**:

| Requirement | Solution |
|---|---|
| Global CDN for static content | HTTP cache + Workers |
| User auth at edge | JWT validation in Worker |
| Cache dynamic responses | Workers + HTTP Cache-Control |
| Rate limiting | KV (simple) or Durable Objects (accurate) |
| Session state | Durable Objects + WebSocket |
| Complex transactions | Origin database + Workers proxy |
| Real-time sync | Durable Objects + WebSocket |
| Analytics/metrics | Analytics Engine |

## Practical Focus

Design an e-commerce platform:

```
1. Product catalog (read-heavy):
   - Edge cache with long TTL
   - KV for feature flags & pricing
   
2. Shopping cart (user state):
   - Durable Object per user session
   - WebSocket for real-time updates
   - TTL: 24 hours (abandon after checkout)
   
3. Checkout (complex):
   - Route to origin (PCI compliance, inventory locks)
   - Worker validates user, checks inventory cache
   - Worker waits for origin response, updates session
   
4. Monitoring:
   - Analytics Engine tracks traffic by region
   - Alerts on cart abandonment rate
   - Logs all failed checkouts
```

**Trade-offs**:
- Edge cache = smaller origin load, but stale data possible
- DO sessions = consistent state, but per-user cost
- Hybrid = complexity, but performance + safety

## Key Takeaway

**The best edge architecture combines multiple patterns—stateless caching for performance, DOs for coordination, origin for truth.**

## Reading

1. **Cloudflare**: [Architecture Patterns](https://developers.cloudflare.com/workers/platform/best-practices/) (~7 min)
2. **Your Own Capstone Project Brief** (designed for you in [`capstone/project-brief.md`](../capstone/project-brief.md))

## Bridge to Next Day

Tomorrow: **Final Capstone & Course Wrap-up**.
