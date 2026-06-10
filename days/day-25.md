# Day 25: Security at the Edge — Input Validation & Injection Prevention

## Concepts

**Common Vulnerabilities at the Edge**:
1. **Injection** (SQL, NoSQL, command)
2. **XSS** (cross-site scripting)
3. **CSRF** (cross-site request forgery)
4. **Insecure Deserialization**

**Input Validation**: Never trust user input. Validate **type**, **length**, **format**:
```javascript
function validateUserId(id) {
  // Type check
  if (typeof id !== 'string') throw new Error('Invalid type');
  
  // Length
  if (id.length > 32) throw new Error('Too long');
  
  // Format (alphanumeric only)
  if (!/^[a-z0-9]+$/.test(id)) throw new Error('Invalid format');
  
  return id;
}
```

**Parameterized Queries**: Never concatenate user input into queries:
```javascript
// WRONG
await db.query(`SELECT * FROM users WHERE id = '${userId}'`);

// RIGHT
await db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

**Output Encoding**: When rendering HTML, escape special characters:
```javascript
const name = getUserInput();  // "Alice<script>alert('xss')</script>"
const html = `<h1>${escapeHtml(name)}</h1>`;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

**CORS & CSRF**: Use `SameSite` cookies and verify origins:
```javascript
response.headers.set('Set-Cookie', 'session=abc; SameSite=Strict; Secure; HttpOnly');
```

**Content Security Policy (CSP)**: Restrict where scripts can load from:
```javascript
response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' cdn.example.com");
```

## Practical Focus

Build a secure API handler:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/api/user') {
      const userId = url.searchParams.get('id');
      
      // Validate input
      try {
        validateUserId(userId);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Invalid user ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Parameterized query (if using DB)
      const user = await fetchUserById(userId, env);
      
      if (!user) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Return with security headers
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
};

function validateUserId(id) {
  if (!id || typeof id !== 'string') throw new Error('Invalid');
  if (!/^[a-z0-9]{1,32}$/.test(id)) throw new Error('Invalid format');
}

async function fetchUserById(userId, env) {
  // Assume parameterized query or ORM
  // const result = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return { id: userId, name: 'Alice' }; // Mock
}
```

## Key Takeaway

**Security at the edge starts with input validation and parameterized queries—stop attacks early, before they reach your backend.**

## Reading

1. **OWASP**: [Top 10 API Security Risks](https://owasp.org/www-project-api-security/) (~10 min, skim)
2. **Cloudflare**: [Web Application Firewall](https://developers.cloudflare.com/waf/) (~5 min)

## Bridge to Next Day

Tomorrow: **Security Deep-Dive: Secrets, TLS, & Rate Limiting**.
