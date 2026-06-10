# Lab 1: Hello Workers – Deployment & Basic Handlers

**Objective**: Set up Wrangler, create a basic Worker, deploy it, and test it live.

**Time**: 45 min

**Prerequisites**: Node.js 18+, Cloudflare account (free tier OK)

---

## Setup

1. **Install Wrangler**:
```bash
npm install -g wrangler
# or: npx wrangler (no global install needed)
```

2. **Authenticate**:
```bash
wrangler login
# Opens browser, authenticate with Cloudflare
```

3. **Create project**:
```bash
wrangler init hello-workers
cd hello-workers
```

When prompted:
- TypeScript? → Yes (or No, up to you)
- Publish to? → Yes (we'll set route later)

---

## Part 1: Basic Handler

**Edit `src/index.js`** (or `src/index.ts`):
```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path === '/') {
      return new Response('Hello from the edge!', { status: 200 });
    }
    
    if (path === '/api/info') {
      return new Response(JSON.stringify({
        method: request.method,
        url: request.url,
        cf: request.cf // Cloudflare metadata
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
};
```

---

## Part 2: Local Testing

**Start dev server**:
```bash
wrangler dev
```

Output should show: `Listening on http://localhost:8787`

**Test endpoints**:
```bash
# Terminal 1: keep wrangler dev running

# Terminal 2: test requests
curl http://localhost:8787/
# Output: Hello from the edge!

curl http://localhost:8787/api/info
# Output: {"method":"GET","url":"...","cf":{...}}

curl http://localhost:8787/notfound
# Output: Not found
```

---

## Part 3: Deploy

**Update `wrangler.toml`**:
```toml
name = "hello-workers"
type = "javascript"
account_id = "YOUR_ACCOUNT_ID"  # From Cloudflare Dashboard
workers_dev = true

# Compatibility settings
compatibility_date = "2024-01-01"
```

(Get `account_id` from https://dash.cloudflare.com/?account=)

**Deploy**:
```bash
wrangler deploy
```

Output should show: `Deployed to https://hello-workers.<YOUR_NAME>.workers.dev`

**Test live**:
```bash
curl https://hello-workers.<YOUR_NAME>.workers.dev/
curl https://hello-workers.<YOUR_NAME>.workers.dev/api/info
```

---

## Part 4: Challenge

1. **Add a `/stats` endpoint** that returns:
   - Worker name
   - Deployment region (from `request.cf.colo`)
   - Client IP (from `request.cf` or headers)

2. **Add error handling**: Return a sensible 500 error if an endpoint throws.

3. **Add logging**: Print incoming requests to console, visible in `wrangler tail`.

---

## Deliverables

- [ ] Worker deployed to `*.workers.dev` URL
- [ ] All endpoints (/, /api/info, /stats) respond correctly
- [ ] Error handling in place
- [ ] Logs visible in `wrangler tail`

---

## Reference

- **Cloudflare Docs**: https://developers.cloudflare.com/workers/get-started/
- **Wrangler**: https://developers.cloudflare.com/workers/wrangler/
