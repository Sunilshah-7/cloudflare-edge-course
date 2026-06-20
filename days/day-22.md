# Day 22: Analytics Engine & Real-Time Metrics

## Concepts

**Analytics Engine**: Cloudflare's time-series database for edge workloads. Write data points at the edge, query via API or Dashboard.

**Use Cases**:
- Track API latency (p50, p95, p99)
- Count errors per endpoint
- Monitor rate limiter activity
- Measure cache hit rates

**Data Model**: Each point is:
- A set of **dimensions** (string labels: country, user_id, endpoint)
- A set of **indexes** (numeric aggregable values: latency, count, bytes)
- A **timestamp**

**API**:
```javascript
// Write a data point
await analytics.writeDataPoint({
  indexes: [latency, statusCode],
  blobs: ['user', 'endpoint']
});

// Query via GraphQL (through dashboard or API)
query {
  viewer {
    accounts(first: 1) {
      edges {
        node {
          analyticsEngine {
            queryLatencies(limit: 10) {
              sum { indexes }
              avg { indexes }
            }
          }
        }
      }
    }
  }
}
```

**Pricing**: Pay per data point written. Typically $0.50 per million points. Low cost for high-volume workloads.

## Practical Focus

Track API latency per endpoint:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const startTime = Date.now();
    
    const response = await fetch(request);
    const duration = Date.now() - startTime;
    
    // Write analytics
    if (env.ANALYTICS_ENGINE) {
      // indexes: [latency_ms, status_code]
      // blobs: [endpoint, country]
      const country = request.cf?.country || 'unknown';
      
      await env.ANALYTICS_ENGINE.writeDataPoint({
        indexes: [duration, response.status],
        blobs: [url.pathname, country]
      });
    }
    
    return response;
  }
};
```

**wrangler.toml**:
```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS_ENGINE"
```

**Query via GraphQL**:
```graphql
{
  viewer {
    accounts(first: 1) {
      edges {
        node {
          analyticsEngine {
            httpRequests1mGroups(
              filter: {
                datetime_geq: "2024-01-01T00:00:00Z"
              }
              limit: 100
            ) {
              sum { indexes }
              avg { indexes }
              dimensions { blob1 blob2 }  # endpoint, country
            }
          }
        }
      }
    }
  }
}
```

## Key Takeaway

**Analytics Engine lets you build real-time dashboards of edge traffic—write points at scale, query patterns as they emerge.**

## Reading

1. **Cloudflare**: [Analytics Engine Overview](https://developers.cloudflare.com/analytics/) (~7 min)
2. **Cloudflare**: [Writing & Querying Data](https://developers.cloudflare.com/analytics/graphql-api/) (~7 min)

## Bridge to Next Day

Tomorrow: **Cost Optimization & Resource Planning**—make your edge deployment economical.
