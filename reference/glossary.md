# Glossary: Cloudflare Edge Computing

## Core Concepts

**Edge Computing**: Computation distributed geographically close to end users, minimizing latency and improving resilience.

**Colo** (Colocation): A Cloudflare datacenter. Cloudflare operates 300+ colos globally. Requests route to nearest colo.

**Cold Start**: Time to spin up a new instance of code. Cloudflare Workers: ~1–5ms (fast). AWS Lambda: ~100–500ms (slow).

**V8 Isolate**: Lightweight JavaScript VM used by Cloudflare Workers. Per-request isolation without container overhead.

---

## Cloudflare Services

**Cloudflare Workers**: Serverless compute at the edge. Intercepts requests, runs code, returns response. 15-min CPU time limit.

**Durable Objects (DO)**: Stateful compute at the edge. Unique, persistent object per ID. Backed by SQLite. ~10k concurrent connections per DO.

**Workers KV**: Global, eventually-consistent key-value store. Built-in caching at all edge locations. ~60s replication lag.

**Analytics Engine**: Time-series database for edge workloads. Write metrics, query via GraphQL. Low latency, high throughput.

**Wrangler**: CLI for developing, testing, deploying Workers. Handles secrets, environments, local dev server.

---

## HTTP & Caching

**Cache-Control**: HTTP header controlling browser & CDN caching.
- `max-age=3600` — browser caches for 1 hour
- `s-maxage=86400` — CDN (surrogate) caches for 24 hours
- `Cache-Tag: product-123` — tag for batch invalidation

**Surrogate Key**: Tag applied to cached responses. Allows cache purge by tag instead of URL (useful for related content).

**Stale-While-Revalidate**: Serve stale content while fetching fresh in background. Improves perceived perf.

**Cache-Aside Pattern**: Check cache → on miss, fetch origin → cache result → return.

---

## Request/Response

**Request Object**: Incoming HTTP request. Accessible in Worker via `request` param.
- `request.method` — HTTP method (GET, POST, etc.)
- `request.headers` — HTTP headers (map-like)
- `request.cf` — Cloudflare metadata (IP, country, colo, TLS version)
- `request.body` — Request body (stream)

**Response Object**: Outgoing HTTP response. Constructed via `new Response(body, options)`.
- `body` — response content (string, stream, etc.)
- `status` — HTTP status code
- `headers` — HTTP headers (map-like)

**Fetch API**: Make HTTP requests from Worker.
```javascript
fetch(url, options) → Promise<Response>
```

---

## State & Persistence

**Strongly Consistent**: All reads & writes reflect the same state. One writer, all readers see same value (after write completes). Durable Objects guarantee this per ID.

**Eventually Consistent**: Updates propagate over time. KV is eventually consistent (write in us-east-1, readable everywhere within ~60s).

**Storage API**: DO storage abstraction (backed by SQLite).
- `get(key)` — retrieve value
- `put(key, value)` — store value
- `delete(key)` — remove key
- `transaction(callback)` — atomic multi-key operations

**SQL API** (Enterprise): Direct SQL queries on DO's SQLite backend.

---

## Real-Time Communication

**WebSocket**: Persistent, bidirectional connection between client & server.
- **connect**: Upgrade HTTP request to WebSocket
- **send**: Server → client message
- **onmessage**: Client receives message
- **close**: Terminate connection

**Broadcast**: Server sends same message to many clients simultaneously.

**Hibernation**: Pause DO between WebSocket messages to reduce compute cost. Resume on next message.

---

## Performance & Operations

**Latency**: Time for request to travel from client → edge → server → client. Measured in ms.

**Throughput**: Requests per second (req/s).

**CPU Time**: Time Worker is actively computing. Billed in 100ms increments. Limit: ~30s per request.

**TTL** (Time-To-Live): How long cached data remains valid before expiring.

**Canary Release**: Route small percentage of traffic (e.g., 5%) to new version before full rollout.

**Blue-Green Deployment**: Run two versions simultaneously, switch routing when new version verified. Allows instant rollback.

---

## Security

**Injection**: Attacker inserts malicious input (SQL, commands, etc.). Prevent via parameterized queries & input validation.

**XSS** (Cross-Site Scripting): Attacker injects JavaScript into rendered HTML. Prevent via output encoding.

**CSRF** (Cross-Site Request Forgery): Attacker tricks user into making unintended request. Prevent via `SameSite` cookies.

**Rate Limiting**: Restrict request volume per user/IP over time window. Prevent abuse & DDoS.

**DDoS** (Distributed Denial of Service): Attacker floods server with requests from many IPs. Cloudflare mitigates at network edge.

---

## Architecture Patterns

**API Gateway**: Central entry point for all requests. Handles auth, routing, rate limiting, logging.

**Cache-Aside**: Lazy cache population. Check cache → miss → fetch & cache → return.

**Sharding**: Partition data/state across multiple instances. E.g., user:0-999 → DO shard 0, user:1000-1999 → DO shard 1.

**Circuit Breaker**: Stop calling failing service for a time, then retry. Prevents cascade.

**Graceful Degradation**: Serve reduced functionality (cached, fallback) when primary service fails.

---

## Metrics & Observability

**Metrics**: Numeric measurements (latency, error count, cache hit rate).

**Dimensions**: Labels for grouping metrics (endpoint, country, user_id).

**Indexes**: Numeric aggregable fields in Analytics Engine (e.g., latency, status code).

**Blobs**: String labels in Analytics Engine (e.g., endpoint, user_id).

**Tail Latency**: High percentile latency (p95, p99). Often more important than average.

---

## Deployment & Configuration

**Environment**: Distinct deployment (staging, production). Each has separate secrets, routes, config.

**Wrangler.toml**: Configuration file for Workers project. Defines name, account, routes, secrets, environments.

**Secret**: Encrypted credential (API key, password) stored by Cloudflare. Not visible in code or logs.

**Variable**: Non-secret configuration (API URL, feature flag). Visible in code.

---

## Networking

**TLS/HTTPS**: Encrypted HTTP. Cloudflare terminates TLS for you.

**TTL**: How long DNS record is cached locally.

**CNAME**: Alias one domain to another. Used for routing to Cloudflare.

**Origin**: Your backend server (where requests ultimately go if not cached/handled at edge).

---

## Pricing Concepts

**Requests**: Number of HTTP requests handled. Free: 100k/month, then $0.50 per million.

**Duration**: CPU time used. Billed in 100ms increments. ~$0.50 per million CPU-seconds.

**KV Operations**: Separate pricing for reads (~$0.50/M) and writes (~$5/M). Writes are expensive!

**DO Requests**: ~$0.15 per million requests.

**DO Duration**: ~$1.25 per million CPU-seconds.

**Analytics Engine**: ~$0.50 per million data points written.

---

## Abbreviations

| Abbrev | Meaning |
|---|---|
| CDN | Content Delivery Network |
| DNS | Domain Name System |
| DO | Durable Objects |
| KV | Key-Value store |
| OT | Operational Transformation |
| CRDT | Conflict-free Replicated Data Type |
| JWT | JSON Web Token |
| JWKS | JSON Web Key Set |
| TLS | Transport Layer Security |
| CORS | Cross-Origin Resource Sharing |
| CSRF | Cross-Site Request Forgery |
| CSP | Content Security Policy |
| XSS | Cross-Site Scripting |
| DDoS | Distributed Denial of Service |
| PCI | Payment Card Industry (compliance) |
| SQL | Structured Query Language |
| REST | Representational State Transfer |
| RPC | Remote Procedure Call |
| P50/P95/P99 | Percentile latency |
