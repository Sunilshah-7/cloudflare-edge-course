# Day 14: Week 2 Wrap-up & Intro to Stateful Edge Computing

## Concepts

**The Statelessness Problem**: Workers are ephemeral—no persistent connection to a client, no background threads, no state between requests. For many workloads, this is fine. But some require coordination:

- **Session state**: Track user presence in real-time multiplayer
- **Rate limit counters**: Accurate per-user or per-session quotas
- **Atomic updates**: Modify a value and read the result in one operation
- **Transactions**: Coordinate changes across multiple resources

**KV is Insufficient**: KV is eventually consistent and has no atomic operations. Writing to KV from multiple Workers is a race condition.

**Enter Durable Objects**: Cloudflare's solution for stateful compute at the edge. A Durable Object is:
- A **unique, persistent, JavaScript object** with its own ID
- Accessible from any Worker globally
- **Strongly consistent** within one DO's state
- Backed by SQLite storage (transactional)

**DO vs. Worker**:
- Worker: Request → response (stateless, fast, parallelizable)
- Durable Object: WebSocket or RPC (stateful, coordinated, consistent)

## Week 2 Recap: Production Patterns

- **Day 8**: Middleware chains (composition, separation of concerns)
- **Day 9**: JWT & OAuth (stateless auth at the edge)
- **Day 10**: Secrets & config (safety)
- **Day 11**: Local dev & debugging (velocity)
- **Day 12**: Performance optimization (parallelism)
- **Day 13**: Graceful degradation (resilience)
- **Day 14**: Intro to Durable Objects (stateful edge)

**You now understand edge patterns**: How to intercept requests, transform them, authenticate, cache intelligently, and recover from failure. Workers are the stateless foundation. Now we add state.

## Practical Focus

Conceptual exercise: Which workload should use DO vs. KV vs. Worker-only?

- **Session server** (online/offline tracking): Durable Object (strong consistency required)
- **Feature flags** (read-heavy, occasional writes): Workers + KV (pure caching)
- **API gateway** (throttle & proxy): Worker (stateless, fast)
- **Collaborative editor** (concurrent edits, conflict resolution): Durable Object (state & coordination)
- **Rate limiter** (need accurate counters): Durable Object (atomic increments)

## Key Takeaway

**KV + Workers handle stateless caching; Durable Objects handle stateful coordination. Choose based on consistency requirements, not "sophistication."**

## Reading

1. **Cloudflare**: [Durable Objects Overview](https://developers.cloudflare.com/durable-objects/) (~7 min)
2. **Cloudflare**: [When to Use Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#when-to-use-durable-objects) (~3 min)

## Bridge to Week 3

Next week: We dive deep into Durable Objects, building session stores, rate limiters, and WebSocket servers at the edge. If you've made it here, you've mastered the stateless edge—now prepare for state.

---

## Lab 2: Middleware Chain & Auth

**Objective**: Build a middleware-based API gateway with JWT auth, CORS, and request logging.

**Deliverables**:
1. A Worker with auth, CORS, and logging middleware
2. Protected endpoints that require valid JWT
3. Test locally with `wrangler dev`

See [`labs/lab-02-middleware-chain.md`](../labs/lab-02-middleware-chain.md) for full brief.
