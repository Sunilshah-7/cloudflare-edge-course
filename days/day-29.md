# Day 29: Building the Capstone — Design Phase

## Capstone Project: Real-Time Collaborative Notebook

**The Challenge**: Build a collaborative document editor that:
- Allows multiple users to edit the same document simultaneously
- Shows real-time cursor positions and selections
- Persists changes durably
- Scales to 1000+ concurrent users
- Minimizes latency (target: sub-200ms sync)

**Architecture Decisions**:

1. **Frontend (Client)**:
   - WebSocket connection to Durable Object
   - Local editing with optimistic updates
   - Conflict resolution (last-write-wins or OT)

2. **Durable Objects (Coordination)**:
   - One DO per document
   - Tracks cursor positions, selections, changes
   - Validates & broadcasts updates to all clients
   - Persists all edits to storage

3. **Workers (Public API)**:
   - Route document creation requests
   - Provide HTTP endpoints for auth, document listing
   - WebSocket handoff to DO

4. **KV (Metadata)**:
   - Document ownership, permissions
   - Feature flags for collaboration features

5. **Analytics Engine**:
   - Track concurrent users per document
   - Measure sync latency
   - Monitor error rates

**Design Questions to Answer**:
- How do you detect and resolve concurrent edits? (last-write-wins? OT? CRDT?)
- What's your storage model in DO SQLite? (append-only log? consolidated state?)
- How do you handle dropped connections? (retry, ack, tombstones?)
- What's your permission model? (owner, readers, editors?)

## Practical Focus

**Day 29: Design Phase** (15 min)

1. **Write down your architecture**:
   - Sketch Workers, DOs, KV, client
   - Label data flow (requests, WebSockets)
   - Identify persistence points

2. **Define your data schema**:
   - What's in a document?
   - What fields in each edit event?
   - How do you store in DO?

3. **Plan conflict resolution**:
   - Two users edit simultaneously—what wins?
   - Write pseudo-code for your strategy

See [`capstone/project-brief.md`](../capstone/project-brief.md) for the full specification and starter code.

## Key Takeaway

**Good architecture comes before code—design your boundaries, data flow, and failure modes first, then implement.**

## Reading

1. **Capstone Project Brief**: [`capstone/project-brief.md`](../capstone/project-brief.md) (full spec)
2. **Draft your design doc** — sketch on paper or in a text editor

## Bridge to Next Day

Tomorrow: **Day 30 - Implementation & Wrap-up**. We'll implement core features of the capstone and reflect on the month.
