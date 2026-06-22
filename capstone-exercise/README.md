# Collaborative Notebook

A real-time collaborative notebook capstone built with Cloudflare Workers, SQLite-backed Durable Objects, WebSockets, Yjs, CodeMirror 6, Next.js, and TypeScript.

The app lets multiple users open the same notebook, edit together in real time, see collaborator presence, share viewer/editor links, manage permissions, inspect history, revert changes, and view basic analytics.

Live url: https://collaborative-notebook.sunilshah2416.workers.dev/

## Features

- Real-time collaborative editing over WebSockets.
- One Durable Object per document.
- SQLite-backed Durable Object persistence.
- Yjs CRDT updates for text conflict resolution.
- CodeMirror 6 editor integration.
- Owner/editor/viewer permissions.
- Share links with selected role.
- Change history with revert actions.
- Collaborator presence and cursor updates.
- Title updates synchronized to connected clients.
- Basic analytics: edits, connections, active users, bytes in, bytes out.
- Session persistence across refreshes.

## Architecture Summary

```text
Browser / Next.js UI
  |
  | HTTP: /api/session, /api/documents, /api/documents/:id/*
  | WS:   /edit/:docId
  v
Cloudflare Worker
  |
  | Routes each document to env.NOTEBOOK.getByName(docId)
  v
NotebookDocument Durable Object
  |
  | Coordinates WebSocket clients
  | Applies Yjs updates
  | Checks permissions
  | Broadcasts updates/presence/title changes
  v
SQLite-backed Durable Object storage
```

## Key Design Decisions

### Conflict Resolution

The app uses a hybrid strategy:

- Notebook text uses **Yjs CRDT** updates.
- Durable Object coordinates permissions, persistence, revision numbers, and broadcast order.
- Simple metadata like title uses last saved value.
- Cursor/presence state is ephemeral and uses latest update wins.

This avoids last-write-wins data loss for document text while keeping the system simpler than implementing Operational Transformation from scratch.

### State Storage

The app uses hybrid storage:

- `document_state` stores the current content, CRDT snapshot, and revision for fast loading.
- `crdt_updates` stores append-only CRDT updates.
- `changes` stores old/new text snapshots for history and revert.
- `documents` stores metadata.
- `permissions` stores document access.
- `analytics_daily` stores usage counters.

### Scaling

The app starts with one Durable Object per document. This keeps one strongly consistent coordinator for each notebook while scaling horizontally across documents.

For unusually hot documents, the planned path is to add fanout Durable Object shards while keeping one coordinator Durable Object as the only writer.

## Decisions Log

| Area | Decision | Rationale |
|---|---|---|
| Conflict resolution | Hybrid strategy with Yjs CRDT for document text | Prevents concurrent text edits from overwriting each other without implementing Operational Transformation from scratch |
| Metadata conflict handling | Last saved value for simple fields like title | Title is a scalar field, so CRDT complexity is unnecessary |
| Presence handling | Ephemeral latest-update-wins state | Cursor and active-user state should be live but not durable document content |
| State storage | Hybrid current snapshot plus append-only history/update logs | Fast document loads from `document_state`, with audit/revert support from `changes` and CRDT durability from `crdt_updates` |
| Scaling | Start with one Durable Object per document | Keeps each document strongly consistent and simple; scales horizontally across documents |
| Hot-document scaling path | Add fanout Durable Object shards later if needed | Avoids v1 complexity while preserving a credible path for unusually large documents |
| Editor | CodeMirror 6 | Provides a richer notebook editing surface than a textarea while remaining lightweight |
| Authentication | Signed demo sessions | Sufficient for capstone demo; production could swap in an external identity provider |

## Performance Metrics

The test suite includes local Worker-runtime load checks. These are not a substitute for deployed-region load testing, but they provide a repeatable baseline.

Latest local run:

```text
Test: 100 edits per second on one document
Environment: local Cloudflare Worker test runtime
Clients: 1 editor WebSocket, 1 observer WebSocket
Duration: approximately 1 second
Result: 100 accepted edits, final revision 100, persisted content verified
Ack latency: p50 4ms, p95 13ms, p99 24ms, max 29ms
```

Additional load-style coverage:

- 10 concurrent WebSocket clients connected to the same document.
- One edit broadcast verified across all 10 connected clients.
- 100 edits/sec test verifies final observer update and persisted document state.

Planned deployed-load validation:

- Run the 100 edits/sec test against the deployed Worker.
- Record p50, p95, p99 ack latency.
- Record broadcast latency and error rate.
- Increase connected clients from 10 to 100, then 1,000 if needed.

## Project Structure

```text
app/
  layout.tsx              Next.js app layout
  page.tsx                App entry page
  globals.css             Global styles

components/
  notebook-app.tsx        Main collaborative notebook UI

src/
  index.ts                Cloudflare Worker routes and HTTP API
  notebook.ts             NotebookDocument Durable Object
  auth.ts                 Demo session and share-token signing
  messages.ts             WebSocket message types
  encoding.ts             Base64/binary helpers
  env.ts                  Worker environment types

test/
  index.spec.ts           Worker, WebSocket, storage, and CRDT tests

architecture.md           Detailed architecture plan
wrangler.jsonc            Cloudflare Worker configuration
```

## Requirements

- Node.js
- npm
- Wrangler
- Cloudflare account for deployment

Install dependencies:

```bash
npm install
```

## Environment Variables

Local development uses `.dev.vars`.

Create it from the example:

```bash
cp .dev.vars.example .dev.vars
```

Example:

```env
SESSION_SECRET="replace-with-a-local-random-secret"
```

For production, set the secret with Wrangler:

```bash
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` is used to sign demo session cookies and share links.

## Local Development

Build the static Next.js frontend and start Wrangler:

```bash
npm run dev
```

Wrangler serves the static frontend from `out/` and routes API/WebSocket requests through the Worker.

Typical local URL:

```text
http://localhost:8787
```

To test collaboration manually:

1. Open the app in one browser tab.
2. Create or open a notebook.
3. Copy the `?doc=...` URL.
4. Open the same URL in another tab or browser.
5. Edit in one tab and watch the other update.

## Scripts

```bash
npm run dev             Build frontend and run Wrangler locally
npm run dev:next        Run only the Next.js dev server
npm run dev:worker      Run only Wrangler
npm run build           Build the Next.js frontend
npm run build:frontend  Build the Next.js frontend
npm run test            Run Vitest tests
npm run typecheck       Run TypeScript checking
npm run deploy          Build frontend and deploy with Wrangler
npm run cf-typegen      Generate Cloudflare Worker types
```

## HTTP API

### Session

```text
POST /api/session
```

Creates or refreshes a signed demo session cookie. If a valid session already exists, the same user id is preserved.

### Documents

```text
POST  /api/documents
GET   /api/documents/:id
PATCH /api/documents/:id
```

Creates a document, reads document metadata/current content, or updates the title.

### History

```text
GET  /api/documents/:id/history
POST /api/documents/:id/revert
```

Lists change history and reverts to an old/new snapshot from a selected change.

### Permissions

```text
GET /api/documents/:id/permissions
PUT /api/documents/:id/permissions/:userId
```

Lists permission grants and grants viewer/editor access to a specific user id.

### Sharing

```text
POST /api/documents/:id/share
POST /api/share/accept
```

Creates and accepts signed share links.

### Analytics

```text
GET /api/documents/:id/analytics
```

Returns daily edit, connection, active user, and byte counters.

### WebSocket

```text
GET /edit/:docId
```

Upgrades to a WebSocket connection for real-time document collaboration.

## WebSocket Messages

Client to server:

```json
{ "type": "edit", "update": "base64-yjs-update", "clientSeq": 1, "clientTs": 1710000000000 }
{ "type": "edit", "content": "legacy full text fallback" }
{ "type": "cursor", "pos": 42, "selection": { "anchor": 40, "head": 42 } }
{ "type": "ping", "clientTs": 1710000000000 }
```

Server to client:

```json
{ "type": "init", "title": "Notebook", "content": "...", "snapshot": "base64-yjs-snapshot", "revision": 1, "users": [] }
{ "type": "update", "content": "...", "update": "base64-yjs-update", "from": "user-id", "revision": 2 }
{ "type": "title", "title": "Updated title", "from": "user-id" }
{ "type": "cursor", "userId": "user-id", "pos": 42, "selection": { "anchor": 40, "head": 42 } }
{ "type": "users", "active": [] }
{ "type": "ack", "clientSeq": 1, "revision": 2, "serverTs": 1710000000100, "clientTs": 1710000000000 }
{ "type": "pong", "serverTs": 1710000000100, "clientTs": 1710000000000 }
{ "type": "error", "code": "forbidden", "message": "Viewers cannot edit this document." }
```

## Testing

Run all tests:

```bash
npm test
```

Run only the main test file:

```bash
npx vitest test/index.spec.ts
```

Run type checking:

```bash
npm run typecheck
```

Run frontend build:

```bash
npm run build:frontend
```

The test suite covers:

- Unknown route handling.
- Session creation and refresh identity persistence.
- Document creation and metadata reads.
- Share-link permission grants.
- WebSocket init.
- Legacy edit synchronization.
- History persistence.
- Title persistence over WebSocket init.
- Active user state on connect.
- Cursor broadcast state.
- Active user state on disconnect.
- Yjs CRDT convergence for concurrent updates.
- 10 concurrent WebSocket clients connected to the same document.
- 100 edits per second against one document, with p50/p95/p99 ack latency metrics, in the local Worker test runtime.

## Deployment

Set the production secret:

```bash
npx wrangler secret put SESSION_SECRET
```

Deploy:

```bash
npm run deploy
```

The deploy script builds the Next.js static frontend and deploys the Worker with Wrangler.

## Rubric Checklist

### Core Durable Object and WebSocket

- Durable Object class for document editing: yes.
- WebSocket accept and message handling: yes.
- Broadcast update from one client to all connected clients: yes.
- Persistent document state: yes, via SQLite-backed DO storage.
- Local multi-tab testing: supported.

### Worker and HTTP API

- `POST /api/documents`: yes.
- WebSocket upgrades routed to correct Durable Object: yes.
- Document metadata endpoints: yes.
- Deploy and live testing: supported through `npm run deploy`.

### UI and End-to-End Behavior

- Frontend: yes, Next.js + TypeScript + CodeMirror.
- WebSocket updates displayed live: yes.
- Manual concurrent editing: yes.
- Automated browser E2E: not currently included.
- Latency measurement: yes, p95 latency shown in the UI.

### Advanced Features

- SQLite-backed Durable Object storage: yes.
- Change history and revert: yes.
- Owner/editor/viewer permissions: yes.
- Rich editor integration: yes, CodeMirror 6.

## Notes

This is a capstone/demo app. It uses signed demo sessions instead of a production identity provider. In a production app, raw user ids in the permissions UI would likely be replaced with email or organization-based identity search.
