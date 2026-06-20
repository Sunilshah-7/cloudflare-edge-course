# Day 23: Cost Optimization & Resource Planning

## Concepts

**Cloudflare Pricing Model**:
- **Workers Requests**: First 100k free, then $0.50 per million
- **Workers Duration**: Billed in 100ms increments (pay for CPU time)
- **KV Reads/Writes**: Reads ~$0.50 per million, writes ~$5 per million
- **Durable Objects**: ~$0.15 per million requests, ~$1.25 per million seconds CPU
- **Analytics Engine**: ~$0.50 per million data points

**Common Bottleneck: KV Writes**. Writing is 10x more expensive than reading. Batch writes when possible.

**Cost Levers**:
1. **Cache Aggressively**: Every cache hit saves a Worker invocation
2. **Parallelize Fetches**: Reduce duration by running concurrent operations
3. **Early Returns**: Respond before fetching origin (error handling, cached content)
4. **Limit KV Writes**: Use in-memory state when safe; persist periodically
5. **Choose DO or KV Wisely**: KV for large read-heavy datasets; DO for coordinated small state

**Estimation Example** (1M daily users, 10 requests each = 10M daily requests):
- Workers: 10M × $0.50 / 1M = $5.00
- KV Reads: 20M (cache misses 50%) × $0.50 / 1M = $10.00
- KV Writes: 1M (feature flags updated hourly) × $5 / 1M = $5.00
- **Daily**: ~$20, **monthly**: ~$600

**Optimization**: Add caching (reduce KV writes from 1M to 100k):
- KV Writes: 100k × $5 / 1M = $0.50/day = $15/month
- **Savings**: $585/month

## Practical Focus

Measure and optimize costs:

```javascript
export default {
  async fetch(request, env) {
    const metrics = {
      kvReads: 0,
      kvWrites: 0,
      workerDuration: 0,
      cacheHit: false
    };
    
    const startTime = Date.now();
    
    // 1. Check HTTP cache
    const cacheKey = new Request(request.url, { method: 'GET' });
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    
    if (response) {
      metrics.cacheHit = true;
      metrics.workerDuration = Date.now() - startTime;
      
      // Write metrics to Analytics Engine (cheaper than tracking in logs)
      await env.ANALYTICS_ENGINE?.writeDataPoint({
        indexes: [metrics.workerDuration, 1], // 1 = cache hit
        blobs: [new URL(request.url).pathname, request.cf?.country || 'unknown']
      });
      
      return response;
    }
    
    // 2. Fetch origin
    const originResponse = await fetch(request);
    
    // 3. Cache result for 1 hour
    await cache.put(cacheKey, originResponse.clone());
    metrics.kvWrites++;
    
    metrics.workerDuration = Date.now() - startTime;
    
    // Write metrics
    if (env.ANALYTICS_ENGINE) {
      await env.ANALYTICS_ENGINE.writeDataPoint({
        indexes: [metrics.workerDuration, 0], // 0 = cache miss
        blobs: [new URL(request.url).pathname, request.cf?.country || 'unknown']
      });
    }
    
    return originResponse;
  }
};
```

## Key Takeaway

**Cost optimization is about targeting the expensive operations (KV writes, duration) and reducing them through caching and parallelism.**

## Reading

1. **Cloudflare**: [Pricing Overview](https://developers.cloudflare.com/workers/platform/pricing/) (~5 min)
2. **Cloudflare**: [Cost Optimization Guide](https://developers.cloudflare.com/workers/platform/cost-optimization/) (~7 min)

## Bridge to Next Day

Tomorrow: **Deployment & Environment Management**—rolling out safely to production.
