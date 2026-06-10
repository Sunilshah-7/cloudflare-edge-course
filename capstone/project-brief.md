# Capstone Project: Real-Time Collaborative Notebook

**Level**: Senior Software Engineer  
**Estimated Time**: 4–8 hours (or spread across days 29–30 and beyond)  
**Technologies**: Cloudflare Workers, Durable Objects, WebSockets, SQLite

---

## Overview

Build a **collaborative document editor** that allows multiple users to edit the same document simultaneously with:
- Real-time cursor synchronization
- Live text editing (multiple clients, one source of truth)
- Persistent change history
- Scalability to 1000+ concurrent users
- Sub-200ms latency for edits

---

## Architecture

### Components

1. **Frontend (Browser)**
   - Textarea or rich editor (start simple: textarea)
   - WebSocket connection to edge
   - Real-time cursor/selection display
   - Optimistic updates (show changes immediately)

2. **Cloudflare Worker**
   - HTTP endpoints for auth, document creation, metadata
   - WebSocket handoff to Durable Objects
   - Request validation & routing

3. **Durable Object (per-document)**
   - Real-time state coordination
   - Conflict resolution (last-write-wins for MVP)
   - Broadcast updates to all connected clients
   - Persist changes to SQLite storage

4. **Storage**
   - SQL table: `documents` (id, title, owner, created_at)
   - SQL table: `changes` (id, doc_id, user_id, content, timestamp)
   - KV (optional): Document metadata cache

---

## Functional Requirements

### MVP (Minimum Viable Product)

1. **Document Creation**
   - `POST /api/documents` → create new document
   - Returns: document ID, edit URL

2. **Document Opening**
   - `GET /api/documents/:id` → fetch document metadata & content
   - Returns: title, owner, current content

3. **Real-Time Editing**
   - WebSocket connection to `wss://editor.example.com/edit/:doc_id`
   - Client sends: `{ type: "edit", content: "..." }`
   - Server broadcasts: `{ type: "update", content: "...", from: user_id }`

4. **Cursor Sync**
   - Client sends: `{ type: "cursor", pos: 42, userId: "user-123" }`
   - Server broadcasts to other clients: cursor position + user

5. **Persistence**
   - All changes persisted to DO storage
   - On reconnect, send latest content to client

### Stretch Goals

1. **Conflict Resolution**: Use Operational Transformation (OT) or CRDT for concurrent edits
2. **Permissions**: Owner, editor, viewer roles
3. **Change History**: UI to view & revert to past versions
4. **Analytics**: Track edits per document, active collaborators

---

## Data Model

### Database Schema

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_modified DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  old_content TEXT,
  new_content TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES documents(id)
);
```

### WebSocket Message Types

**Client → Server**:
```json
{ "type": "edit", "content": "..." }
{ "type": "cursor", "pos": 42 }
{ "type": "ping" }
```

**Server → Client**:
```json
{ "type": "init", "content": "...", "users": [{ "id": "...", "name": "..." }] }
{ "type": "update", "content": "...", "from": "user-id" }
{ "type": "cursor", "userId": "...", "pos": 42 }
{ "type": "users", "active": [{ "id": "...", "name": "...", "pos": 42 }] }
```

---

## Design Decisions (For You to Make)

1. **Conflict Resolution Strategy**:
   - **Option A**: Last-write-wins (simple, but dumb—later edit overwrites)
   - **Option B**: Operational Transformation (complex, but correct)
   - **Option C**: Hybrid (simple version for MVP)

2. **State Storage**:
   - **Option A**: Store full content in DO state (rebuilt on restart)
   - **Option B**: Append-only log in SQLite, replay on startup
   - **Option C**: Hybrid (current content + log for history)

3. **Scaling Approach**:
   - **Option A**: One DO per document (works up to ~1000 concurrent)
   - **Option B**: Sharded DOs (complex, for massive scale)
   - **Option C**: Start with A, migrate to B if needed

---

## Implementation Roadmap

### Day 1 (2–3 hours): Core DO & WebSocket

- [ ] Create Durable Object class for document editing
- [ ] Implement WebSocket accept & message handling
- [ ] Add basic broadcast (client sends update → all clients receive)
- [ ] Store content in DO state
- [ ] Test locally with multiple tabs

### Day 2 (1–2 hours): Worker & HTTP API

- [ ] Create Worker to handle `POST /api/documents`
- [ ] Route WebSocket upgrades to correct DO
- [ ] Add document metadata HTTP endpoints
- [ ] Deploy & test live

### Day 3 (1–2 hours): UI & E2E Test

- [ ] Build simple HTML frontend (textarea + buttons)
- [ ] Connect WebSocket, display updates
- [ ] Test end-to-end with real concurrent editing
- [ ] Measure latency

### Day 4+ (Optional): Advanced Features

- [ ] Persistent storage (SQLite in DO)
- [ ] Change history & reversions
- [ ] Permissions (owner/editor/viewer)
- [ ] Rich editor integration (e.g., Quill, CodeMirror)

---

## Testing Checklist

### Unit Tests

- [ ] Conflict resolution logic (if implementing OT/CRDT)
- [ ] State transitions (edit, cursor, connect, disconnect)

### Integration Tests

- [ ] Create document → verify HTTP response
- [ ] Open document → verify WebSocket connection
- [ ] Edit in client A → verify update in client B
- [ ] Disconnect client A → verify user list updates
- [ ] Concurrent edits (both clients edit simultaneously) → verify result

### Load Tests

- [ ] 10 concurrent clients on same document
- [ ] 100 edits per second
- [ ] Measure latency (p50, p95, p99)

---

## Deliverables

1. **Code Repository**:
   - Well-structured Worker & DO code
   - Clear README with setup & deployment instructions
   - Tests (unit + integration)

2. **Deployment**:
   - Live URL (`*.workers.dev` or custom domain)
   - Public demo (password-protected OK)

3. **Documentation**:
   - Architecture diagram (ASCII or image)
   - Decisions log (why you chose conflicts strategy X)
   - Performance metrics (latency, throughput)

4. **Reflection** (2–3 paragraphs):
   - What was hardest? Why?
   - What would you do differently if building v2?
   - How would you scale this to 1M concurrent docs?

---

## Success Criteria

- [ ] MVP works locally and deployed
- [ ] 3+ concurrent users can edit simultaneously
- [ ] Latency < 500ms for edits (reasonable for MVP)
- [ ] No data loss on client disconnect
- [ ] Code is readable, documented, testable

---

## Hints

1. **Start simple**: Get last-write-wins working first, then add sophistication.
2. **Test early**: Build the WebSocket handshake first, worry about conflict resolution later.
3. **Don't over-engineer**: SQLite persistence is nice but not critical for MVP.
4. **Monitor**: Track latency with `Date.now()` on client & server.

---

## References

- **Durable Objects**: https://developers.cloudflare.com/durable-objects/
- **WebSocket API**: https://developers.cloudflare.com/workers/runtime-apis/web/websocket/
- **Operational Transformation**: https://en.wikipedia.org/wiki/Operational_transformation (skim)
- **Collaborative Apps**: https://crdt.tech/ (learn about CRDTs)

---

## Next Steps After Capstone

1. **Deploy to production**: Set up custom domain, monitoring
2. **Add features**: Permissions, history, rich editor
3. **Scale**: Implement sharding if traffic grows
4. **Monetize** (optional): Usage-based billing per document
5. **Share**: Showcase on GitHub, post on dev.to or Medium

---

** 🎉 Good luck! You have everything you need—this is a real, deployable system.**
