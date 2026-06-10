# Day 1: Why Edge Computing? The Latency Problem & Cloudflare's Answer

## Concepts

**The Traditional Model**: Your API runs in a datacenter in us-east-1. A user in Tokyo makes a request. Best-case latency: 150–200ms, round-trip. Your origin is one point of failure, one throttle point, one scaling bottleneck.

**Edge Computing**: Cloudflare operates 300+ datacenters globally. Your code runs on the edge—in the same datacenter where requests arrive. User in Tokyo? Response in 5–20ms from a Tokyo edge location. Distributed, resilient, low-latency by default.

**The Trade-off**: Edge compute is stateless and restricted (no multi-hour jobs). Your database still lives elsewhere. But for 80% of modern workloads (auth, routing, filtering, transformations, cache logic), edge is sufficient and drastically faster.

**Cloudflare's Positioning**: Cloudflare Workers is a serverless compute platform that intercepts requests at Cloudflare's network edge. Unlike Lambda@Edge (AWS), Workers use a pooled V8 isolation model—cold starts are milliseconds, not hundreds of ms.

## Practical Focus

Open https://developers.cloudflare.com/workers/ and skim the "Get Started" section. Note:
- Workers run **synchronous request handlers** (no async I/O within the handler's hot path without care)
- They have **strict execution time limits** (~30s for CPU time)
- They can **modify, cache, or route** incoming requests

This is fundamentally different from a traditional Lambda where you respond to events hours after they fire.

## Key Takeaway

**Edge computing moves latency from the user to the origin by running your code where requests arrive, not where your database lives.**

## Reading

1. **Cloudflare**: [How Cloudflare Works](https://developers.cloudflare.com/fundamentals/get-started/concepts/how-cloudflare-works/) (~5 min)
2. **Cloudflare Learning**: [What is Edge Computing?](https://www.cloudflare.com/learning/serverless/what-is-edge-computing/) — understand why this matters beyond hype (~5 min)

## Bridge to Next Day

Tomorrow we'll zoom into **Worker basics and the runtime environment**—how your code actually executes, what APIs are available, and what's not (IndexedDB? Not in a Worker).
