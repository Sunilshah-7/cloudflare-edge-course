# Cloudflare Edge Computing Masterclass

A **30-day intensive course on distributed edge computing** with Cloudflare, designed for senior software engineers. Each daily module takes ~15 minutes and builds toward mastery of Workers, Durable Objects, Analytics Engine, and edge-native architecture patterns.

## Course Structure

### **Week 1: Edge Computing Fundamentals** (Days 1–7)

Foundation concepts: edge vs. traditional infrastructure, Cloudflare's global network, latency trade-offs, and Workers runtime basics.

### **Week 2: Workers & Request Handling** (Days 8–14)

Deep dive into Cloudflare Workers: request/response handling, middleware patterns, deployment, debugging, and performance optimization.

### **Week 3: Stateful Edge with Durable Objects** (Days 15–21)

Distributed state management: Durable Objects architecture, coordination patterns, SQL databases, and consistency models for the edge.

### **Week 4: Analytics, Observability & Production** (Days 22–30)

Monitoring at scale: Analytics Engine, real-time dashboards, production patterns, cost optimization, and security considerations.

## Daily Format

Each lesson includes:

- **Concepts**: Technical deep-dive (5 min read)
- **Practical Focus**: Hands-on code or configuration (5 min)
- **Key Takeaway**: Core insight to retain
- **Reading**: Cloudflare docs + external resources (≤ 5 min)
- **Bridge to Next Day**: How this connects to tomorrow's topic

## Labs & Capstone

- **4 Hands-On Labs** (45–90 min each, completed during or after week)
- **1 Capstone Project** (build a production-ready edge app)

## Getting Started

1. Clone this repo
2. Read Day 1 in [`./days/`](./days/)
3. Do the daily 15-minute module
4. Complete labs as you progress through each week

---

## Quick Reference

- **Workers Docs**: https://developers.cloudflare.com/workers/
- **Durable Objects**: https://developers.cloudflare.com/durable-objects/
- **Analytics Engine**: https://developers.cloudflare.com/analytics/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/

---

## Prerequisites

- Familiarity with HTTP/REST APIs
- Basic JavaScript/TypeScript
- Understanding of DNS and CDN concepts
- A Cloudflare account (free tier sufficient for labs)

---

## Structure Navigation

```
cloudflare-edge-course/
├── README.md (this file)
├── days/
│   ├── day-01.md through day-30.md
├── labs/
│   ├── lab-01-hello-workers.md
│   ├── lab-02-middleware-chain.md
│   ├── lab-03-durable-objects.md
│   └── lab-04-observability.md
├── capstone/
│   └── project-brief.md
└── reference/
    ├── glossary.md
    ├── architecture-patterns.md
    └── troubleshooting.md
```

---

## Author's Notes

This course assumes you're a senior engineer wanting to deeply understand Cloudflare's edge platform, not just use it for static hosting. You'll learn **why** edge computing matters, **when** to use it, and **how** to architect resilient, scalable systems that survive failure modes traditional CDNs can't.

Focus on the core mental models—the specific APIs and syntax matter less than understanding trade-offs between edge compute, Durable Objects, and traditional backends.

---

## Table of Contents

- [Cloudflare Edge Computing Masterclass](#cloudflare-edge-computing-masterclass)
  - [Course Structure](#course-structure)
    - [**Week 1: Edge Computing Fundamentals** (Days 1–7)](#week-1-edge-computing-fundamentals-days-17)
    - [**Week 2: Workers \& Request Handling** (Days 8–14)](#week-2-workers--request-handling-days-814)
    - [**Week 3: Stateful Edge with Durable Objects** (Days 15–21)](#week-3-stateful-edge-with-durable-objects-days-1521)
    - [**Week 4: Analytics, Observability \& Production** (Days 22–30)](#week-4-analytics-observability--production-days-2230)
  - [Daily Format](#daily-format)
  - [Labs \& Capstone](#labs--capstone)
  - [Getting Started](#getting-started)
  - [Quick Reference](#quick-reference)
  - [Prerequisites](#prerequisites)
  - [Structure Navigation](#structure-navigation)
  - [Author's Notes](#authors-notes)
  - [Table of Contents](#table-of-contents)
