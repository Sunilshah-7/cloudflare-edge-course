# Reflection

## 1. What was hardest? Why?

The hardest part was keeping real-time collaboration correct while still making the system understandable enough for a capstone project. A collaborative editor looks simple from the outside, but small mistakes can cause lost edits, duplicate updates, stale titles, reconnect loops, or users seeing different document state. The most important design decision was avoiding last-write-wins for notebook content and using Yjs CRDT updates instead, because concurrent text editing needs merge semantics rather than overwrite semantics.

Another difficult part was coordinating several types of state that behave differently. Document text must be durable and conflict-safe, title metadata must be saved and broadcast, cursor presence should be live but not persisted as document content, and permissions must be enforced on both HTTP and WebSocket paths. The Durable Object helped by giving each document one authoritative coordinator, but the frontend still needed careful lifecycle handling so React state updates did not accidentally reconnect sockets or create new sessions.

Testing was also challenging because WebSocket systems are event-driven. It is not enough to test a single request/response path; the tests need to open multiple sockets, attach listeners before messages arrive, verify broadcasts, check disconnect behavior, and simulate concurrent edits. The load-style tests added confidence, but they also showed why real-time systems need both correctness tests and operational metrics.

## 2. What would you do differently if building v2?

For v2, I would replace the demo session system with a real identity provider and improve the sharing model around emails or organization users instead of raw user IDs. The current signed demo sessions are useful for a capstone, but a production version should support durable user accounts, revocation, audit logs, and clearer permission management. I would also add a better permissions UI with named users, pending invites, and explicit owner transfer behavior.

I would also improve the persistence strategy around CRDT compaction and observability. The current hybrid model stores current content, CRDT snapshots, update logs, and history, which is a strong foundation. In v2, I would add scheduled compaction, retention policies, richer document version previews, and explicit restore points. I would also mirror important metrics to a dedicated analytics system so latency, reconnects, active users, and edit throughput can be monitored across deployed regions.

Finally, I would add automated browser E2E tests. The current test suite has strong Worker, WebSocket, CRDT, and load-style integration coverage, but it does not launch real browser contexts to verify CodeMirror behavior visually. A v2 test plan should include Playwright tests for two browser users editing at once, viewer read-only behavior, share-link acceptance, title synchronization, and history revert from the actual UI.

## 3. How would you scale this to 1M concurrent docs?

The current architecture already scales naturally across documents because each document maps to its own Durable Object with `getByName(docId)`. That means 1M concurrent documents would not be handled by one global coordinator; they would be spread across many Durable Object instances. The key is to keep each document's coordination local to its own Durable Object while making the Worker stateless, so HTTP requests and WebSocket upgrades can route to the right document without shared in-memory state.

At that scale, I would focus on operational controls: WebSocket hibernation, strict message size limits, backpressure handling, CRDT update compaction, and aggressive observability. Most documents will likely be cold or lightly active, so hibernation and compact snapshots matter more than optimizing for every document being hot. I would also store long-term analytics and audit data outside the document coordinator path so active editing remains low latency.

For hot documents, I would add fanout Durable Object shards while keeping one coordinator Durable Object as the only writer of document state. Clients would connect to shard Durable Objects, shards would forward edits to the coordinator, and the coordinator would commit CRDT updates before broadcasting them back through the shards. For extremely large documents or write-heavy workloads, I would consider splitting documents into sections or Yjs subdocuments, but only after measuring that a single-document coordinator had become the bottleneck.
