# Lab 3: Durable Objects & Real-Time Sync

**Objective**: Build a collaborative counter using Durable Objects and WebSockets.

**Time**: 90 min

**Prerequisites**: Lab 1 completed, basic understanding of WebSockets

---

## Setup

Create new project:
```bash
wrangler init collab-counter
cd collab-counter
```

---

## Part 1: Durable Object Class

Create `src/counter.js`:

```javascript
export class Counter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Set(); // Active WebSocket connections
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const { 0: client, 1: server } = new WebSocketPair();
      
      server.accept();
      this.clients.add(server);
      
      // Send initial state
      const count = (await this.state.storage.get('count')) || 0;
      server.send(JSON.stringify({
        type: 'init',
        value: count,
        activeUsers: this.clients.size
      }));
      
      // Handle messages
      server.onmessage = async (event) => {
        await this.handleMessage(server, JSON.parse(event.data));
      };
      
      server.onclose = () => {
        this.clients.delete(server);
        this.broadcast({
          type: 'users',
          activeUsers: this.clients.size
        });
      };
      
      return new Response(null, { status: 101, webSocket: client });
    }
    
    // HTTP endpoint: get current count
    if (url.pathname === '/get') {
      const count = (await this.state.storage.get('count')) || 0;
      return new Response(JSON.stringify({ value: count }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Upgrade required', { status: 400 });
  }

  async handleMessage(sender, msg) {
    if (msg.type === 'increment') {
      const current = (await this.state.storage.get('count')) || 0;
      const newValue = current + 1;
      await this.state.storage.put('count', newValue);
      
      this.broadcast({
        type: 'update',
        value: newValue,
        from: msg.clientId
      });
    } else if (msg.type === 'decrement') {
      const current = (await this.state.storage.get('count')) || 0;
      const newValue = Math.max(0, current - 1);
      await this.state.storage.put('count', newValue);
      
      this.broadcast({
        type: 'update',
        value: newValue,
        from: msg.clientId
      });
    } else if (msg.type === 'reset') {
      await this.state.storage.put('count', 0);
      this.broadcast({
        type: 'update',
        value: 0,
        from: msg.clientId
      });
    }
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      client.send(data);
    }
  }
}
```

---

## Part 2: Worker

Update `src/index.js`:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/counter' && request.headers.get('Upgrade') === 'websocket') {
      const counterId = url.searchParams.get('id') || 'default';
      const counter = env.COUNTER.get(counterId);
      return await counter.fetch(request);
    }
    
    if (url.pathname === '/counter/get') {
      const counterId = url.searchParams.get('id') || 'default';
      const counter = env.COUNTER.get(counterId);
      return await counter.fetch(request);
    }
    
    return new Response('Not found', { status: 404 });
  }
};
```

---

## Part 3: Configuration

Update `wrangler.toml`:

```toml
name = "collab-counter"
type = "javascript"
account_id = "YOUR_ACCOUNT_ID"
workers_dev = true
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "COUNTER"
class_name = "Counter"

[durable_objects]
migrations = [
  {tag = "v1", new = ["Counter"]}
]
```

---

## Part 4: Test Client

Create `test-client.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Collaborative Counter</title>
  <style>
    body { font-family: sans-serif; }
    #counter { font-size: 48px; margin: 20px 0; }
    button { padding: 10px 20px; margin: 5px; font-size: 16px; }
    #users { color: gray; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>Collaborative Counter</h1>
  <div id="counter">0</div>
  <div id="users">Users: 0</div>
  <button onclick="increment()">+</button>
  <button onclick="decrement()">-</button>
  <button onclick="reset()">Reset</button>
  
  <script>
    const counterId = 'shared';
    const clientId = 'client-' + Math.random().toString(36).substr(2, 9);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/counter?id=${counterId}`);
    
    ws.onopen = () => console.log('Connected');
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'init' || msg.type === 'update') {
        document.getElementById('counter').textContent = msg.value;
      }
      
      if (msg.type === 'init' || msg.type === 'users') {
        document.getElementById('users').textContent = `Users: ${msg.activeUsers}`;
      }
    };
    
    ws.onerror = (e) => console.error('WebSocket error:', e);
    ws.onclose = () => console.log('Disconnected');
    
    function increment() {
      ws.send(JSON.stringify({ type: 'increment', clientId }));
    }
    
    function decrement() {
      ws.send(JSON.stringify({ type: 'decrement', clientId }));
    }
    
    function reset() {
      ws.send(JSON.stringify({ type: 'reset', clientId }));
    }
  </script>
</body>
</html>
```

---

## Part 5: Testing

**Local dev**:
```bash
wrangler dev
```

**Open browser**:
- Go to http://localhost:8787 (or serve test-client.html)
- Open multiple tabs with the same counter ID
- Click increment/decrement in one tab
- **Verify**: All tabs update in real-time

**Test via HTTP**:
```bash
# In one terminal
wrangler dev

# In another terminal
curl "http://localhost:8787/counter/get?id=shared"
# Output: {"value":5}
```

---

## Part 6: Challenge

1. **Add persistence**: Store last 10 operations (increment/decrement/reset) in DO storage.
2. **Add user presence**: Track unique users by client ID, display in UI.
3. **Add access control**: Only owner of counter can reset.

---

## Deliverables

- [ ] Counter increments/decrements correctly
- [ ] Multiple clients see real-time updates
- [ ] Active user count displayed
- [ ] Persistent state (survives DO restart)
- [ ] Test client works with 3+ concurrent users

---

## Reference

- **Durable Objects**: https://developers.cloudflare.com/durable-objects/
- **WebSockets**: https://developers.cloudflare.com/workers/runtime-apis/web/websocket/
