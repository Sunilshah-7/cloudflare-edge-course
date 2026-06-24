# Day 19: SQL & Complex Queries in Durable Objects

## Concepts

**SQL Access** (Enterprise/Advanced tier): Durable Objects use SQLite under the hood. Enterprise accounts can run direct SQL queries:

```javascript
const result = await this.state.storage.sql.exec(
  'SELECT * FROM users WHERE id = ? AND active = 1',
  [userId]
);
```

**Schema Management**: Create tables on DO init:
```javascript
if (!await this.state.storage.sql.exec('SELECT name FROM sqlite_master WHERE type="table" AND name="users"')) {
  await this.state.storage.sql.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
```

**Transactional Queries**: SQL operations within transactions are atomic:
```javascript
await this.state.storage.transaction(async (txn) => {
  await txn.storage.sql.exec(
    'UPDATE users SET balance = balance - ? WHERE id = ?',
    [amount, userId]
  );
});
```

**Limitations**:
- No joins across DOs (one DO = one table/schema)
- Queries must complete within Worker CPU limits (~30s)
- No direct indexing yet (though queries are optimized)

**When NOT to Use**: If you have complex multi-table queries or massive datasets, use a traditional SQL database (Postgres, MySQL) and cache results in KV + DO for hot paths.

## Practical Focus

Build a user ledger system with SQL:

```javascript
export class UserLedger {
  constructor(state, env) {
    this.state = state;
  }

  async initialize() {
    await this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async fetch(request) {
    await this.initialize();
    const url = new URL(request.url);
    
    if (url.pathname === '/add') {
      const userId = url.searchParams.get('user_id');
      const amount = parseFloat(url.searchParams.get('amount'));
      
      await this.state.storage.sql.exec(
        'INSERT INTO ledger (user_id, amount) VALUES (?, ?)',
        [userId, amount]
      );
      
      return new Response('Added');
    }
    
    if (url.pathname === '/balance') {
      const userId = url.searchParams.get('user_id');
      const result = await this.state.storage.sql.exec(
        'SELECT SUM(amount) as total FROM ledger WHERE user_id = ?',
        [userId]
      );
      
      const balance = result[0]?.total || 0;
      return new Response(JSON.stringify({ userId, balance }));
    }
    
    return new Response('Not found', { status: 404 });
  }
}
```

## Key Takeaway

**SQL lets you run complex queries at the edge without leaving the DO—great for ledgers, analytics, and coordinated multi-row updates.**

## Reading

1. **Cloudflare**: [SQL Support (Enterprise)](https://developers.cloudflare.com/d1/sql-api/sql-statements/) (~7 min)
2. **SQLite**: [SQL Syntax](https://www.sqlite.org/lang.html) (reference, skim ~5 min)

## Bridge to Next Day

Tomorrow: **Sharding & Scaling Patterns**—how to handle millions of DOs.
