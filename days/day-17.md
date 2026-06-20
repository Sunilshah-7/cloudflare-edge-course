# Day 17: WebSockets & Real-Time State Sync

## Concepts

**WebSocket in Durable Objects**: Unlike Workers (which are request-response), DOs can hold persistent WebSocket connections. Clients maintain a bidirectional channel to the DO.

**Use Cases**:
- Collaborative editing (multiple users editing one doc)
- Multiplayer games (player state sync)
- Live notifications (server pushes to client)
- Presence tracking (online/offline)

**Session Management**: Each WebSocket is a client session. Store sessions in memory:
```javascript
this.clients = new Set(); // Active WebSocket connections
```

**Broadcast Pattern**: When one client sends an update, broadcast to all:
```javascript
broadcast(message) {
  for (const client of this.clients) {
    client.send(JSON.stringify(message));
  }
}
```

**Hibernation**: WebSockets in DOs can be expensive if idle. Use `hibernation` to pause DOs between messages and reduce costs:
- Without hibernation: DO stays active, consuming compute
- With hibernation: DO pauses between messages, resumes on next message

## Practical Focus

Build a collaborative counter with WebSockets:

```javascript
export class CollaborativeCounter {
  constructor(state, env) {
    this.state = state;
    this.clients = new Set();
    this.counter = 0;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') === 'websocket') {
      const { 0: client, 1: server } = new WebSocketPair();
      this.clients.add(server);
      
      server.accept();
      server.send(JSON.stringify({ type: 'sync', value: this.counter }));
      
      server.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'increment') {
          this.counter++;
          this.broadcast({ type: 'update', value: this.counter });
          await this.state.storage.put('counter', this.counter);
        }
      };
      
      server.onclose = () => {
        this.clients.delete(server);
      };
      
      return new Response(null, { status: 101, webSocket: client });
    }
    
    return new Response('Upgrade required', { status: 400 });
  }

  broadcast(message) {
    for (const client of this.clients) {
      client.send(JSON.stringify(message));
    }
  }
}
```

**Client-side** (JavaScript in browser):
```javascript
const ws = new WebSocket('wss://example.com/collab');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'update') {
    document.getElementById('counter').textContent = msg.value;
  }
};

document.getElementById('increment').onclick = () => {
  ws.send(JSON.stringify({ type: 'increment' }));
};
```

## Key Takeaway

**WebSockets let you push state from the edge to clients in real-time—optimal for collaborative or multiplayer workloads where latency matters.**

## Reading

1. **Cloudflare**: [WebSocket Support](https://developers.cloudflare.com/durable-objects/api/websockets/) (~7 min)
2. **Cloudflare**: [Hibernation](https://developers.cloudflare.com/durable-objects/platform/hibernation/) (~4 min)

## Bridge to Next Day

Tomorrow: **Coordination Patterns & Locks**—multiple clients, one resource.
