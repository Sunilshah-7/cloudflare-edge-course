# Day 27: Monitoring, Alerting & Incident Response

## Concepts

**What to Monitor**:
1. **Request Volume** — spikes indicate attacks or traffic shifts
2. **Error Rate** — p99, p95 critical
3. **Latency** — tail latency (p99) matters more than average
4. **Cache Hit Rate** — efficiency metric
5. **Cost Metrics** — KV operations, DO CPU time

**Alert Conditions**:
- Error rate > 1%
- Latency p99 > 5s
- Cache hit rate < 50% (unexpected)
- Unknown origin IP (possible misconfiguration)

**Dashboards**: Real-time visibility into key metrics:
- Cloudflare Dashboard → Analytics
- Analytics Engine → Custom graphs
- External tools: Grafana, Datadog

**Logging for Debugging**:
```javascript
console.log(JSON.stringify({
  level: 'error',
  timestamp: new Date().toISOString(),
  userId,
  error: err.message,
  stack: err.stack,
  context: { endpoint, duration }
}));
```

**Incident Response**:
1. **Detect**: Alert fires (automated or manual report)
2. **Investigate**: Check logs, metrics, recent deployments
3. **Mitigate**: Rollback, adjust rate limits, point origin elsewhere
4. **Resolve**: Fix root cause, deploy fix, monitor
5. **Postmortem**: Document what happened, what we'll do differently

## Practical Focus

Build an alerting integration (example with Slack):

```javascript
export async function sendAlert(env, message, severity = 'warning') {
  const color = severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'good';
  
  const payload = {
    attachments: [
      {
        color,
        text: message,
        footer: 'Cloudflare Worker',
        ts: Math.floor(Date.now() / 1000)
      }
    ]
  };
  
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// In your Worker
export default {
  async fetch(request, env) {
    try {
      const response = await fetch(request);
      
      if (response.status >= 500) {
        await sendAlert(env, `Origin returned ${response.status}`, 'critical');
      }
      
      return response;
    } catch (err) {
      await sendAlert(env, `Worker error: ${err.message}`, 'critical');
      return new Response('Service unavailable', { status: 503 });
    }
  }
};
```

**Sample Monitoring Dashboard** (pseudo-SQL for Analytics Engine):
```graphql
{
  viewer {
    accounts(first: 1) {
      edges {
        node {
          analyticsEngine {
            # Latency p99
            latencyP99: httpRequests1mGroups(
              limit: 1
              filter: { datetime_geq: "now - 1h" }
            ) {
              quantiles(value: "latency", quantile: 0.99) { value }
            }
            # Error rate
            errorRate: httpRequests1mGroups(
              limit: 1
              filter: { datetime_geq: "now - 1h" }
            ) {
              sum { blobs, indexes }
            }
          }
        }
      }
    }
  }
}
```

## Key Takeaway

**Monitoring at the edge is critical—you can't SSH to debug, so instrument everything and set up alerts before issues hit customers.**

## Reading

1. **Cloudflare**: [Analytics Engine GraphQL](https://developers.cloudflare.com/analytics/graphql-api/features/aggregations/) (~7 min)
2. **Observability Engineering**: [The Three Pillars](https://www.oreilly.com/library/view/observability-engineering/9781492076438/) (skim intro ~5 min)

## Bridge to Next Day

Tomorrow: **Best Practices & Patterns Summary** — recap what we've learned.
