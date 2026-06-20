# Day 5: Workers KV—Distributed Cache Strategy

## Concepts

**Workers KV** is a global, eventually-consistent key-value store. Write in one region, readable everywhere within ~60 seconds. Ideal for configuration, feature flags, session tokens, rate-limit counters—not real-time atomic operations.

**Write-Through Model**: 
1. Write in your region (e.g., us-east-1)
2. Cloudflare propagates to all edge locations
3. Reads are immediate in your region, eventually consistent elsewhere

**Not a Database**: KV has no transactions, no schema, no ranges. Use it as a cache or config store, not as a persistent data layer. Values are immutable once written (you replace, not update).

**Namespace**: Each Worker gets a KV namespace. Access via `env.YOUR_NAMESPACE`:
```javascript
await env.CONFIG.put('cache-ttl', '3600', { expirationTtl: 86400 });
const value = await env.CONFIG.get('cache-ttl');
```

**Edge Caching**: Writes replicate to all 300+ colos within a minute. Reads are cached locally after first access—subsequent reads are nearly free.

## Practical Focus

Build a feature-flag system:

```javascript
export default {
  async fetch(request, env) {
    const featureKey = 'feature:new-checkout';
    
    // Check KV cache
    let enabled = await env.FEATURE_FLAGS.get(featureKey);
    if (enabled === null) {
      // Miss: fetch from origin
      const resp = await fetch(`https://config.example.com/flags/${featureKey}`);
      enabled = await resp.text();
      // Cache for 1 hour
      await env.FEATURE_FLAGS.put(featureKey, enabled, { expirationTtl: 3600 });
    }
    
    if (enabled === 'true') {
      return new Response('Feature enabled', { status: 200 });
    }
    return new Response('Feature disabled', { status: 404 });
  }
};
```

## Key Takeaway

**KV is write-once, eventually-consistent global state—perfect for caching config and flags, broken for anything requiring strong consistency.**

## Reading

1. **Cloudflare**: [Workers KV Overview](https://developers.cloudflare.com/kv/get-started/) (~5 min)
2. **Cloudflare**: [KV Limits & Pricing](https://developers.cloudflare.com/kv/platform/limits/) (~3 min) — understand operations/month caps

## Bridge to Next Day

Tomorrow: **Caching Strategies**. We'll combine HTTP caching, KV, and origin shields to minimize requests to your backend.
