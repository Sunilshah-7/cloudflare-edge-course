# Troubleshooting Guide

Common issues and solutions for Cloudflare edge development.

---

## Wrangler & Deployment

### Issue: `wrangler dev` fails with "Account not found"

**Solution**:
1. Run `wrangler logout` then `wrangler login`
2. Verify `wrangler.toml` has correct `account_id` (from https://dash.cloudflare.com/?account=)
3. Check account is not suspended

---

### Issue: `wrangler deploy` says "No route configured"

**Solution**:
- Option 1: Add `workers_dev = true` in `wrangler.toml` (deploys to `*.workers.dev`)
- Option 2: Add explicit route:
  ```toml
  [[routes]]
  pattern = "api.example.com/*"
  zone_name = "example.com"
  ```
- Verify zone ID matches (find in Cloudflare Dashboard)

---

### Issue: Deployed Worker times out (504 Gateway Timeout)

**Solution**:
1. Check for infinite loops or blocking operations
2. Add timeout handling:
   ```javascript
   const timeout = Promise.race([
     fetch(...),
     new Promise((_, reject) => 
       setTimeout(() => reject(new Error('Timeout')), 5000)
     )
   ]);
   ```
3. Check if Worker is hitting CPU limit (~30s). Reduce operations or parallelize.

---

## Runtime Issues

### Issue: "Module not found" or "require is not defined"

**Solution**:
- Workers don't support CommonJS (`require`). Use ES modules (`import`).
- Check `wrangler.toml` has `type = "javascript"` or `"typescript"`
- Ensure dependencies are bundled (use `npm install`, not global packages)

---

### Issue: `Storage not available` in local dev

**Solution**:
- Wrangler mocks KV/DO storage locally
- Check binding name matches `wrangler.toml`:
  ```toml
  [env.development]
  kv_namespaces = [
    { binding = "MY_KV", id = "..." }
  ]
  ```
- Use exact binding name in code: `env.MY_KV`

---

### Issue: WebSocket connection fails in DO

**Solution**:
1. Verify `request.headers.get('Upgrade') === 'websocket'`
2. Return `new Response(null, { status: 101, webSocket: client })`
3. In local dev, `wrangler dev` may not fully support WebSockets—test deployed instead
4. Check if origin is rejecting WebSocket upgrade (some firewalls block)

---

## Performance

### Issue: Worker is too slow (latency > 1 second)

**Solution**:
1. **Measure**: Add timers to identify bottleneck
   ```javascript
   const t1 = Date.now();
   const data = await fetch(...);
   console.log(`Fetch took ${Date.now() - t1}ms`);
   ```
2. **Parallelize**: Use `Promise.all()` for concurrent fetches
3. **Cache**: Use HTTP cache or KV for frequent data
4. **Early return**: Respond before fetching origin (errors, cached content)

---

### Issue: High KV operation costs

**Solution**:
- KV writes are 10x more expensive than reads
- Batch writes: do `put` every 60s, not every request
- Use HTTP cache for read-heavy data (free)
- Use DO with persistent storage for coordinated writes

---

## Security

### Issue: Secrets visible in logs or code

**Solution**:
1. **Never hardcode** secrets in code
2. Use `wrangler secret put`:
   ```bash
   wrangler secret put API_KEY
   # Prompted for value, encrypted
   ```
3. Access via `env.API_KEY` (same as vars, but encrypted)
4. Check `wrangler tail` output—verify secrets not logged

---

### Issue: CORS errors in browser

**Solution**:
1. Add CORS headers in Worker:
   ```javascript
   response.headers.set('Access-Control-Allow-Origin', 'https://example.com');
   response.headers.set('Access-Control-Allow-Methods', 'GET,POST');
   ```
2. Handle OPTIONS preflight:
   ```javascript
   if (request.method === 'OPTIONS') {
     return new Response(null, {
       status: 204,
       headers: {
         'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
   }
   ```

---

### Issue: JWT validation failing

**Solution**:
1. Verify token format: `header.payload.signature`
2. Check expiry: `exp` claim > current time
3. Verify signature with JWKS (public key)
4. Use library: `npm install jose`
   ```javascript
   import { jwtVerify } from 'jose';
   const secret = new TextEncoder().encode(env.JWT_SECRET);
   const { payload } = await jwtVerify(token, secret);
   ```

---

## Durable Objects

### Issue: "Durable Object is not defined" or binding missing

**Solution**:
1. Check `wrangler.toml`:
   ```toml
   [[durable_objects.bindings]]
   name = "MY_DO"
   class_name = "MyClass"
   
   [durable_objects]
   migrations = [
     {tag = "v1", new = ["MyClass"]}
   ]
   ```
2. Verify class is exported: `export class MyClass { ... }`
3. Redeploy: `wrangler deploy --latest-migrations`

---

### Issue: DO state is lost after restart

**Solution**:
- DO memory is ephemeral (lost after ~60s idle)
- Persist important data to `storage`:
  ```javascript
  await this.state.storage.put('key', value);
  const value = await this.state.storage.get('key');
  ```
- Storage survives restarts (backed by SQLite)

---

### Issue: Multiple clients don't see each other's updates

**Solution**:
1. Verify all clients connect to same DO ID:
   ```javascript
   const do = env.MY_DO.get(docId);  // Same docId?
   ```
2. Use `broadcast()` to send to all:
   ```javascript
   for (const client of this.clients) {
     client.send(JSON.stringify(msg));
   }
   ```
3. Check WebSocket is fully established before sending

---

## Monitoring & Debugging

### Issue: Can't see logs from deployed Worker

**Solution**:
1. Use `wrangler tail`:
   ```bash
   wrangler tail --env production
   ```
2. Check Cloudflare Dashboard → Workers → Logs tab
3. Verify Worker is actually being invoked (check request count)
4. Logs only appear for `console.log()` after Worker execution starts

---

### Issue: Analytics Engine data doesn't appear

**Solution**:
1. Verify binding exists:
   ```toml
   [[analytics_engine_datasets]]
   binding = "ANALYTICS_ENGINE"
   ```
2. Write test data:
   ```javascript
   await env.ANALYTICS_ENGINE.writeDataPoint({
     indexes: [latency, statusCode],
     blobs: [endpoint]
   });
   ```
3. Query via GraphQL (dashboard or API)
4. Data may take 1–2 minutes to appear

---

## Rate Limiting & DDoS

### Issue: Legitimate traffic getting rate-limited

**Solution**:
1. Check rate limit rules (Cloudflare Dashboard → WAF → Rate Limiting)
2. Increase threshold or add bypass rule
3. If using custom DO rate limiter, verify logic:
   ```javascript
   // Log to debug
   console.log(`User ${userId}: count=${count}, limit=${limit}`);
   ```

---

### Issue: Origin being hammered despite caching

**Solution**:
1. Check `Cache-Control` header returned from origin
2. Ensure `s-maxage` is set (browser-only cache doesn't help origin)
3. Monitor cache hit rate (should be > 80% for healthy cache)
4. Use surrogate keys for batch invalidation instead of per-URL purges

---

## References

- **Cloudflare Status**: https://www.cloudflarestatus.com/
- **GitHub Issues**: https://github.com/cloudflare/workers-ai/issues
- **Community**: https://discord.gg/cloudflaredev
- **Support**: https://support.cloudflare.com/
