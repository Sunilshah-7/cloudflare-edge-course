# Real-Time Collaborative Notebook Architecture

## Summary

This capstone implements a production-leaning real-time collaborative notebook on Cloudflare Workers, Durable Objects, WebSockets, SQLite-backed Durable Object storage, CodeMirror, and Yjs.

Core architecture decisions:

- **Conflict resolution**: Use Yjs CRDT updates instead of last-write-wins so concurrent edits merge without overwriting another user's work.
- **State storage**: Use a hybrid model: current content snapshot, CRDT snapshot, append-only CRDT update log, and required `documents` / `changes` history tables.
- **Scaling**: Use one Durable Object per document for v1. This keeps each document's state strongly coordinated while scaling horizontally across many documents.
- **Realtime transport**: Use WebSocket hibernation via Durable Objects so idle connected clients can remain connected without keeping the object active in memory.
- **Auth model**: Use signed demo sessions for the capstone. Document-level permissions live inside the document Durable Object.

The system is optimized for the project requirements:

- multiple users editing the same document
- real-time cursor and selection sync
- durable persistence
- change history and revert
- owner/editor/viewer permissions
- edit and collaborator analytics
- sub-200ms target latency for normal collaboration paths
- a v1 path to 1000+ collaborators per hot document

## System Diagram

```text
Browser
  |
  | HTTP: session, document APIs, history, permissions, analytics
  | WebSocket: /edit/:docId
  v
Cloudflare Worker
  |
  | validates requests, resolves session, routes by docId
  v
NotebookDocument Durable Object
  |
  | one object per document
  | coordinates edits, cursors, users, permissions
  v
SQLite-backed Durable Object Storage
  |
  | documents
  | document_state
  | changes
  | crdt_updates
  | permissions
  | analytics_daily
```

## Components

### Frontend

The browser app is the collaborative notebook client.

Responsibilities:

- Render the notebook workspace.
- Maintain a local `Y.Doc` with shared `Y.Text` named `body`.
- Render the editor with CodeMirror.
- Apply optimistic local edits immediately.
- Send Yjs CRDT updates over WebSocket.
- Receive remote CRDT updates and apply them to the local Yjs document.
- Send cursor and selection presence updates.
- Display active collaborators.
- Display connection status, role, revision, and latency.
- Show history and allow reverting to prior versions.
- Show permissions and grant editor/viewer access as owner.
- Show analytics counters.

Important UI modules:

- document title/header
- CodeMirror editor surface
- collaborator presence panel
- remote cursor decorations
- connection and latency status bar
- history/revert panel
- permissions/share controls
- analytics panel

Client behavior:

- Local edits are optimistic.
- Edit updates are batched on a short timer to avoid excessive tiny WebSocket frames.
- Cursor updates are throttled.
- Reconnect uses the latest server snapshot from the Durable Object.
- Text updates are reliable after server acceptance.
- Cursor updates are presence-only and can be lossy.

### Cloudflare Worker

The Worker is the public API gateway and asset server.

Responsibilities:

- Serve static frontend assets.
- Create and refresh signed demo sessions.
- Validate HTTP request shape and WebSocket upgrade requests.
- Resolve user identity from signed cookies.
- Route document-scoped operations to `env.NOTEBOOK.getByName(docId)`.
- Convert Durable Object RPC result envelopes into HTTP responses.
- Keep public routing and auth concerns outside the Durable Object.

Endpoints:

- `POST /api/session`
- `POST /api/documents`
- `GET /api/documents/:id`
- `PATCH /api/documents/:id`
- `GET /api/documents/:id/history`
- `POST /api/documents/:id/revert`
- `GET /api/documents/:id/permissions`
- `PUT /api/documents/:id/permissions/:userId`
- `POST /api/documents/:id/share`
- `POST /api/share/accept`
- `GET /api/documents/:id/analytics`
- `GET /edit/:docId`

### Durable Object: `NotebookDocument`

`NotebookDocument` is the source of truth for a single document.

Responsibilities:

- Initialize and maintain the SQLite schema.
- Create document rows and owner permission grants.
- Accept hibernatable WebSockets with `ctx.acceptWebSocket(server)`.
- Store per-socket connection state with `serializeAttachment`.
- Load and maintain an in-memory Yjs document while active.
- Apply CRDT updates and legacy full-content edits.
- Persist accepted edits before broadcasting.
- Broadcast document updates, cursor updates, active users, acknowledgements, and errors.
- Enforce document permissions.
- Store change history.
- Revert to previous history entries by creating a new CRDT transaction.
- Track per-day analytics.
- Compact CRDT update logs after configured thresholds.

Per-connection attachment:

```ts
{
  userId: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  cursor: number | null;
  selection: { anchor: number; head: number } | null;
  connectedAt: number;
}
```

The attachment is intentionally small so it survives WebSocket hibernation and can restore active-user state when the Durable Object wakes.

## Data Model

The implementation keeps the required schema exactly and adds support tables for CRDT state, permissions, and analytics.

Required tables:

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

Support tables:

```sql
CREATE TABLE document_state (
  doc_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  crdt_snapshot BLOB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE crdt_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  update_blob BLOB NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (doc_id, user_id)
);

CREATE TABLE analytics_daily (
  doc_id TEXT NOT NULL,
  day TEXT NOT NULL,
  edit_count INTEGER NOT NULL DEFAULT 0,
  connection_count INTEGER NOT NULL DEFAULT 0,
  max_active_users INTEGER NOT NULL DEFAULT 0,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_id, day)
);
```

Storage semantics:

- `documents` stores document metadata.
- `document_state.content` is the fast readable text snapshot.
- `document_state.crdt_snapshot` is the compact Yjs document state.
- `document_state.revision` is the server revision used for acknowledgements and history display.
- `changes` stores old/new text snapshots for human-readable history.
- `crdt_updates` stores accepted CRDT updates between compactions.
- `permissions` stores owner/editor/viewer grants.
- `analytics_daily` stores document-level daily counters.

## WebSocket Protocol

Client to server:

```json
{ "type": "edit", "update": "base64-yjs-update", "clientSeq": 12, "clientTs": 1710000000000 }
{ "type": "edit", "content": "legacy full text fallback" }
{ "type": "cursor", "pos": 42, "selection": { "anchor": 42, "head": 48 } }
{ "type": "ping", "clientTs": 1710000000000 }
```

Server to client:

```json
{ "type": "init", "content": "...", "snapshot": "base64-yjs-snapshot", "revision": 31, "users": [] }
{ "type": "update", "content": "...", "update": "base64-yjs-update", "from": "user-id", "revision": 32 }
{ "type": "cursor", "userId": "user-id", "pos": 42, "selection": { "anchor": 42, "head": 48 } }
{ "type": "users", "active": [] }
{ "type": "ack", "clientSeq": 12, "revision": 32, "serverTs": 1710000000100 }
{ "type": "pong", "serverTs": 1710000000100, "clientTs": 1710000000000 }
{ "type": "error", "code": "forbidden", "message": "Viewers cannot edit this document." }
```

Batched client messages are supported:

```json
{
  "messages": [
    { "type": "edit", "update": "..." },
    { "type": "cursor", "pos": 42 }
  ],
  "timestamp": 1710000000000
}
```

## Request Flows

### Create Session

```text
Browser -> Worker: POST /api/session
Worker -> Browser: signed HttpOnly session cookie
```

The session includes:

- `userId`
- display name
- expiry
- HMAC signature

### Create Document

```text
Browser -> Worker: POST /api/documents
Worker -> NotebookDocument DO: createDocument(docId, title, ownerId)
DO -> SQLite: insert documents, document_state, owner permission
Worker -> Browser: document id and URLs
```

### Open Document

```text
Browser -> Worker: GET /api/documents/:id
Worker -> DO: getDocument(docId, userId)
DO -> SQLite: check permission, read metadata and snapshot
Worker -> Browser: title, owner, content, revision, role, active users
```

### Connect WebSocket

```text
Browser -> Worker: GET /edit/:docId with Upgrade: websocket
Worker -> DO: forward validated upgrade with user info
DO -> Browser: init message with current content, CRDT snapshot, revision, users
```

### Edit Document

```text
Browser -> DO: edit message with Yjs update
DO: check role
DO: apply update to in-memory Y.Doc
DO -> SQLite: write changes, crdt_updates, document_state, documents.last_modified
DO -> clients: broadcast update
DO -> sender: ack
```

### Cursor Sync

```text
Browser -> DO: cursor message
DO: update socket attachment
DO -> other clients: cursor message
DO -> all clients: users message
```

Cursor state is not written to SQLite because it is ephemeral presence data.

### Revert History

```text
Browser -> Worker: POST /api/documents/:id/revert
Worker -> DO: revert(changeId, target)
DO: check role
DO: load selected old/new content from changes
DO: create a new Yjs transaction replacing current content
DO -> SQLite: append a new changes row and update document_state
DO -> clients: broadcast update
```

Prior history is never mutated or deleted during revert.

## Conflict Resolution Strategy

Yjs CRDT is authoritative for document text.

Why:

- Concurrent inserts/deletes can be merged.
- Updates can be applied in different orders.
- Duplicate updates are safe.
- Client-side optimistic editing is natural.
- The Durable Object remains the authority for persistence and permissions without needing last-write-wins semantics.

Server behavior:

- Accept only edits from `owner` or `editor`.
- Decode base64 Yjs updates into `Uint8Array`.
- Apply the update to the in-memory Yjs document.
- Compute old and new text snapshots.
- Persist the update and snapshots.
- Broadcast the accepted update after persistence.

Legacy behavior:

- The server accepts `{ "type": "edit", "content": "..." }`.
- It converts the full-content replacement into a Yjs transaction.
- This keeps the MVP message shape compatible with the original project brief.

Revision semantics:

- Server revision increments after every accepted edit.
- Revision is used for UI, history, and acknowledgements.
- Revision is not used to reject concurrent CRDT updates.

## Permissions

Roles:

- `owner`: edit, rename, share, manage roles, view history, revert.
- `editor`: edit, rename, view history, revert.
- `viewer`: view, receive updates, send cursor presence.

Permission storage:

- Permission grants are stored in the `permissions` table.
- Each document creator receives an `owner` grant.
- Share links grant either `viewer` or `editor`.

Share links:

- Created by owners.
- Signed by the Worker using `SESSION_SECRET`.
- Include document id, role, and expiry.
- Accepted through `POST /api/share/accept`.

## Analytics

Tracked per document per day:

- edit count
- connection count
- max active users
- bytes in
- bytes out

Live active users are derived from WebSocket attachments rather than stored permanently.

Latency is measured with:

- `clientTs` on edit/ping messages
- `serverTs` on ack/pong messages
- browser receive time

## Scaling Strategy

### V1

Use one Durable Object per document:

```ts
env.NOTEBOOK.getByName(docId)
```

Benefits:

- one strongly consistent writer for each document
- easy routing
- no cross-object merge coordination for normal documents
- horizontal scale across unlimited document ids
- simple failure model

Optimizations:

- WebSocket hibernation for idle connected documents.
- Small per-socket attachments.
- Batched edit frames from the client.
- Throttled cursor updates.
- Current content snapshot for fast reads.
- CRDT snapshot for fast reconnect and restart.
- CRDT update log compaction after thresholds.

Compaction policy:

- Compact after 1000 CRDT updates, or
- Compact when accumulated CRDT update bytes exceed 1 MB.

### Hot Document Path

If one document becomes unusually hot:

- Keep one coordinator Durable Object as the only writer.
- Add fanout Durable Objects for socket distribution.
- Route clients to `docId:shardN`.
- Fanout shards forward edits to the coordinator.
- Coordinator persists and returns committed updates.
- Shards broadcast committed updates locally.

Trigger thresholds:

- more than 750 active sockets, or
- p95 broadcast latency above 200ms for 5 minutes.

Do not implement fanout shards in v1. The architecture leaves room for them without complicating the capstone implementation.

## Reliability And Failure Handling

Reconnect:

- Browser reconnects with backoff.
- Server sends latest snapshot and users in `init`.
- Client applies snapshot to recover.

Invalid messages:

- Invalid JSON returns structured `error`.
- Unknown message types return structured `error`.
- Unauthorized edits return `forbidden`.
- Non-string WebSocket frames are rejected.

Persistence:

- Accepted text edits are persisted before broadcast.
- Storage failures prevent the update broadcast.
- Reads and history remain available when possible.

Presence:

- Cursor state is ephemeral.
- Cursor state is restored from WebSocket attachment after hibernation.
- Cursor updates can be dropped under pressure.

Security:

- Session cookies are signed.
- Share links are signed and expiring.
- Worker validates routes and sessions before routing to Durable Objects.
- Durable Object enforces document-level permissions.
- SQL uses bound parameters.

## Testing Plan

### Unit Tests

- Yjs convergence for concurrent edits.
- Legacy full-content edit compatibility.
- Role helpers and permission checks.
- Cursor updates do not persist document content.
- CRDT compaction preserves final content.

### Integration Tests

- Create session.
- Create document.
- Fetch document metadata.
- Open WebSocket.
- Send edit and receive update.
- Verify history row stores old/new content.
- Grant viewer access through signed share link.
- Verify viewer can open document.

### Browser Tests

- Two browser contexts edit same document.
- Both converge to same text.
- Remote cursors appear.
- Viewer cannot edit.
- Owner can grant roles.
- History revert updates all clients.
- Reconnect reloads current content.

### Load Tests

- 10 clients on one document.
- 100 clients on one document.
- 1000 clients on one deployed document.
- 100 edits/sec for at least 60 seconds.
- Record p50, p95, p99 ack latency.
- Record broadcast latency and error rate.

Acceptance targets:

- all clients converge
- no accepted edit is lost
- local/deployed MVP works
- 3+ users can edit simultaneously
- p95 edit ack below 200ms in normal-region tests
- p95 edit ack below 500ms for globally distant collaborators

## Implementation Files

Backend:

- `src/index.ts`: Worker routes, sessions, API gateway, WebSocket handoff.
- `src/notebook.ts`: Durable Object, persistence, CRDT application, history, permissions, analytics.
- `src/auth.ts`: signed demo sessions and signed share links.
- `src/messages.ts`: shared message and role types.
- `src/encoding.ts`: base64 and binary helpers.

Frontend:

- `app/layout.tsx`: Next.js root layout and metadata.
- `app/page.tsx`: Next.js route that renders the notebook app.
- `app/globals.css`: responsive application styling.
- `components/notebook-app.tsx`: typed React client component for CodeMirror/Yjs, WebSocket protocol, panels, history, permissions, and analytics.
- `out/`: generated static export served by Wrangler assets.

Tests:

- `test/index.spec.ts`: Worker/API/WebSocket/CRDT integration coverage.

Configuration:

- `wrangler.jsonc`: Worker, assets, Durable Object binding, SQLite migration.
- `package.json`: scripts and dependencies.
- `tsconfig.json`: TypeScript configuration.
- `vitest.config.mts`: Cloudflare Worker test pool.

## Operational Notes

Local development:

```bash
cd capstone-exercise
npm install
npm run dev
```

Verification:

```bash
npm run typecheck
npm test
```

Deployment:

```bash
npm run deploy
```

Before production deployment:

- Replace local `SESSION_SECRET` with a Wrangler secret.
- Decide whether demo auth is sufficient or external identity is required.
- Capture load-test metrics on a deployed Worker.
- Review npm audit output and dependency versions.
- Consider adding Analytics Engine as a metrics mirror.
