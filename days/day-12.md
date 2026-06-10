# Day 12: Performance Optimization & Metrics

## Concepts

**CPU Time**: Workers have ~30 second CPU time limit. Monitor with `request.cf`:
- `request.cf.colo` — datacenter ID
- `request.cf.clientTcpRtt` — RTT to client

**Slow Operations**:
- **Fetch**: 50–200ms per round-trip (depends on origin location)
- **JSON parsing**: Negligible unless huge payloads
- **Regex**: O(n) can balloon fast on large strings
- **KV operations**: ~10ms for reads (cached), ~50ms for writes

**Optimization Tactics**:
1. **Batch fetches**: Instead of N sequential fetches, use `Promise.all()` for concurrent requests
2. **Cache aggressively**: KV writes are cheap relative to their benefit
3. **Early returns**: Respond directly (error handling, caching) before fetching origin
4. **Minimize JSON**: Parse only necessary fields; use `streaming` responses if possible

**Metrics to Track**:
- Request count
- Error rate
- Latency (p50, p95, p99)
- Cache hit rate
- CPU time per request

**CloudFlare Analytics Engine**: Collect metrics at the edge and query later (covered in Week 4).

## Practical Focus

Optimize a Worker with parallel fetches:

**Before** (serial):
```javascript
export default {
  async fetch(request, env) {
    const user = await fetch('https://api.example.com/user/123');
    const posts = await fetch('https://api.example.com/user/123/posts');
    const comments = await fetch('https://api.example.com/user/123/comments');
    // Total: 3 round-trips × 100ms = 300ms
  }
};
```

**After** (parallel):
```javascript
export default {
  async fetch(request, env) {
    const [user, posts, comments] = await Promise.all([
      fetch('https://api.example.com/user/123'),
      fetch('https://api.example.com/user/123/posts'),
      fetch('https://api.example.com/user/123/comments'),
    ]);
    // Total: 1 round-trip (concurrent) × 100ms = 100ms
  }
};
```

## Key Takeaway

**Parallelism is your best tool for edge performance—batch fetches, cache hits, and run independent operations concurrently.**

## Reading

1. **Cloudflare**: [Request Metrics (CF Object)](https://developers.cloudflare.com/workers/runtime-apis/web/request/#incomingrequestcfproperties) (~5 min)
2. **Cloudflare**: [Performance Best Practices](https://developers.cloudflare.com/workers/platform/performance-tips/) (~5 min)

## Bridge to Next Day

Tomorrow: **Error Handling & Resilience at the Edge**—graceful degradation under origin failure.
