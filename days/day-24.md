# Day 24: Deployment Strategies & Blue-Green Releases

## Concepts

**Staging Environment**: Use Wrangler environments to test before prod:
```toml
[env.staging]
route = "staging-api.example.com/*"
zone_id = "staging_zone_id"

[env.production]
route = "api.example.com/*"
zone_id = "prod_zone_id"
```

Deploy to staging first: `wrangler deploy --env staging`. Test, then promote.

**Canary Releases**: Route percentage of traffic to new version:
```javascript
const isCanary = Math.random() < 0.1; // 10% traffic
const version = isCanary ? 'v2' : 'v1';
const workerScript = version === 'v2' ? env.WORKER_V2 : env.WORKER_V1;
return await workerScript.fetch(request);
```

**Blue-Green Deployment**:
1. Deploy new version alongside old (both active)
2. Switch routing once new version is verified
3. Keep old version running for quick rollback

In Cloudflare: Use two route patterns, switch via Wrangler config:
```toml
# Old version
[[routes]]
pattern = "api.example.com/*"
zone_name = "example.com"
script_name = "worker-v1"

# New version (initially unused)
# Activate by changing above to point to worker-v2
```

**Rollback Strategy**: Keep last N versions deployed. Rollback is config change + redeploy.

**Health Checks**: After deploying, monitor metrics for errors/latency anomalies:
```bash
wrangler tail --format json | jq 'select(.outcome != "ok")'
```

## Practical Focus

Build a deployment pipeline:

```bash
#!/bin/bash
# deploy.sh - Deploy with canary & monitoring

set -e

ENV="${1:-staging}"

echo "Building..."
npm run build

echo "Deploying to $ENV..."
wrangler deploy --env "$ENV"

echo "Waiting 30s for propagation..."
sleep 30

echo "Running health checks..."
for i in {1..10}; do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" https://api.example.com/health)
  if [ "$RESPONSE" != "200" ]; then
    echo "Health check failed! Rolled back."
    git revert HEAD --no-edit
    wrangler deploy
    exit 1
  fi
  echo "✓ Health check $i passed"
done

echo "✓ Deployment successful"
```

Or use Cloudflare's native **Pages** or **Workers** deployment hooks integrated with GitHub.

## Key Takeaway

**Deployments at the edge are instant, so always have a rollback plan—test in staging, use canaries or blue-green switchovers for safety.**

## Reading

1. **Cloudflare**: [Wrangler Deploy](https://developers.cloudflare.com/workers/wrangler/commands/#deploy) (~5 min)
2. **Cloudflare**: [Environments](https://developers.cloudflare.com/workers/wrangler/environments/) (~5 min)

## Bridge to Next Day

Tomorrow: **Security at the Edge - Input Validation & Injection Prevention**.
