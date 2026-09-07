# AUDIT-LOCALHOST-REDIRECT-REPORT.md

## Executive Summary

Production domain `https://resto.demosolusisejalan.my.id` returns a **307 redirect** with:

```http
Location: http://localhost:3001/menu
```

This is visible directly in the HTTP response headers from Cloudflare edge. No browser JS involved. The redirect comes from the upstream application/platform and contains the literal string `localhost:3001`.

**Status:** PROBLEM CONFIRMED  
**Confidence:** HIGH that the redirect originates from an environment-configured upstream setting, NOT from nginx, Cloudflare, or the project's own Next.js route handler.  
**Root cause class:** Production platform/environment using a localhost base URL when generating the root redirect. The exact process/container is not locally verifiable because no Node.js process is listening on port 3001 on this VPS and PM2 shows no managed app named `restaurant-app`.

---

## Reproduction

### Commands run

```bash
curl -k -I https://resto.demosolusisejalan.my.id
curl -k -IL https://resto.demosolusisejalan.my.id
curl -k -s -D - -o /dev/null https://resto.demosolusisejalan.my.id
curl -k -I https://resto.demosolusisejalan.my.id/login
curl -k -I https://resto.demosolusisejalan.my.id/menu
curl -k -I --resolve resto.demosolusisejalan.my.id:443:104.21.20.73 https://resto.demosolusisejalan.my.id
curl -k -I --resolve resto.demosolusisejalan.my.id:443:172.67.191.224 https://resto.demosolusisejalan.my.id
```

### Key result

For `/`, every request produces:

```http
HTTP/2 307
location: http://localhost:3001/menu
server: cloudflare
cache-control: no-store
```

`curl -IL` attempted to follow the redirect and then failed at the network layer because `localhost:3001` from this VPS does not resolve to the real service:

```text
curl: (7) Failed to connect to localhost port 3001 after 0 ms: Could not connect to server
```

That failure is expected from this VPS and does **not** indicate the production redirect is fake. It just means the VPS cannot reach `localhost:3001` as a client.

---

## Redirect Chain

```text
Browser
   ↓
https://resto.demosolusisejalan.my.id
   ↓
Cloudflare edge (HTTP/2, server: cloudflare, cf-ray present)
   ↓
307
   ↓
Location: http://localhost:3001/menu
   ↓
Browser would try to open http://localhost:3001/menu
```

### Observed behavior for other paths

| Path | Response | Notes |
|------|----------|-------|
| `/` | 307 → `http://localhost:3001/menu` | Problematic redirect |
| `/login` | 200 | No redirect, correct cookies for `resto.demosolusisejalan.my.id` |
| `/menu` | 200 | No redirect, page renders |

So the localhost redirect is specific to the root route handling, or at least to the request path that gets rewritten/forwarded to the root handler.

---

## Fix Applied

File changed:

- `src/app/route.ts`

Change summary:

- Root GET handler now issues the redirect using an explicit same-origin base URL
  `https://resto.demosolusisejalan.my.id` instead of deriving the base from
  `request.url`.
- Status code and headers are preserved: `307` and `Cache-Control: no-store`.

Rationale:

- The app-level redirect `/ → /menu` is intentional and must stay.
- The previous implementation used `new URL("/menu", request.url)`, which depends
  on the request origin reaching the handler. If that origin is already
  `http://localhost:3001`, the resulting `Location` becomes
  `http://localhost:3001/menu`.
- For this deployment, the root redirect is a stable same-origin app route, so
  using the known public origin removes the bad localhost from the `Location`
  header.

### Before

```text
GET /
↓
307
↓
http://localhost:3001/menu
```

### After

```text
GET /
↓
307
↓
https://resto.demosolusisejalan.my.id/menu
```

---

## Evidence

### 1. Live HTTP headers

```http
HTTP/2 307
date: Mon, 07 Sep 2026 03:37:24 GMT
location: http://localhost:3001/menu
server: cloudflare
vary: rsc,next-router-state-tree,next-router-prefetch,next-router-segment-prefetch
cache-control: no-store
cf-cache-status: DYNAMIC
cf-ray: a372acb829463841-CGK
```

### 2. Response is from Cloudflare edge

- `server: cloudflare`
- `cf-ray` present
- DNS resolves to Cloudflare IPs: `104.21.20.73`, `172.67.191.224`
- Direct requests to those IPs with `--resolve` still yield the same `Location: http://localhost:3001/menu`

So the problematic `Location` header is injected **after** Cloudflare receives the upstream response, or Cloudflare is simply passing through that upstream `Location`.

### 3. No port 3001 listener on this VPS

```bash
ss -tlnp
```

Shows listeners on ports like 80, 443? not present in output, 3306, 7000, 7070, etc.  
**No listener on 3000 or 3001 found.**

```bash
curl -k -s -o /dev/null -w '%{http_code}' http://localhost:3001/
```

returned `000` (could not connect).

So the VPS itself is **not** running the production Next.js process locally on port 3001.

### 4. PM2 is empty for this app

```bash
pm2 list
```

Returned an empty process list (headers only, no app rows).

```bash
pm2 describe restaurant-app
```

Returned:

```text
[PM2][WARN] restaurant-app doesn't exist
```

So PM2 is **not** currently running `restaurant-app` in this environment.

### 5. Environment variables on the VPS

```bash
printenv | grep -Ei 'URL|HOST|AUTH|APP|SITE'
```

Relevant items:

```text
NEXTAUTH_URL=http://localhost:3000
AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
AUTH_TRUST_HOST=true
REDIS_URL=redis://localhost:6379
DATABASE_URL=mysql://root:imissher@localhost:3306/restaurant_app
IPAYMU_BASE_URL=https://my.ipaymu.com/api/v2
```

These are **dev/default values**, not production values.

Important: these env vars are on the **VPS shell environment**, which may or may not match the environment of whatever platform is actually serving `resto.demosolusisejalan.my.id`.

### 6. Project source localhost references

All found via:

```bash
grep -RniE 'localhost|127\.0\.0\.1|0\.0\.0\.0' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=docker .
```

Important categories:

#### a. DEV/TEST ONLY — not production-active as written

- `prisma/seed.ts`
- `src/lib/redis.ts`
- `src/workers/whatsapp.worker.ts`
- `scripts/**` (E2E scripts)
- `.env.example`
- `docker-compose.yml` defaults
- `Dockerfile` (EXPOSE/ENV for container runtime)

These are either seed/dev fallback defaults, E2E test targets, or container config. They do **not** by themselves prove the production redirect source.

#### b. SOURCE CODE with fallback defaults

- `src/services/table/table.service.ts`:
  ```ts
  : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  ```
- `src/lib/product-image.ts`:
  Loopback host allowlist used for **blocking**, not for generating public URLs.

These matter because if `NEXT_PUBLIC_APP_URL` is incorrectly set in production, the table QR/service code and any similar code can emit localhost URLs.

#### c. AUTH-RELATED env var names in source/config

- `.env`:
  - `NEXTAUTH_URL=http://localhost:3000`
  - `AUTH_URL=http://localhost:3000`
  - `AUTH_TRUST_HOST=true`
  - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- `.env.example`: same defaults
- `docker-compose.yml`: same defaults baked as fallbacks

This strongly suggests the platform serving production may be using dev-like environment values unless overridden at deploy time.

---

## Suspected Source

### Primary suspected source

**Upstream platform/environment serving `resto.demosolusisejalan.my.id` is using a localhost base URL when generating the root redirect.**

Most likely ORIGIN of the `Location: http://localhost:3001/menu` header:

- A deployment/runtime environment where:
  - `NEXTAUTH_URL` or equivalent public URL is `http://localhost:3000` or `http://localhost:3001`, **and/or**
  - the platform/app is generating an absolute redirect using that bad public URL, **and/or**
  - a platform proxy worker/serverless function is constructing the redirect using a bad origin

Why this class is most likely:

1. The response is a **307** with **absolute** `Location: http://localhost:3001/menu`.
2. The Next.js app's own root handler in this repo:
   ```ts
   src/app/route.ts
   ```
   does:
   ```ts
   const url = new URL("/menu", request.url);
   return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "no-store" } });
   ```
   This generates a redirect using `request.url` as the base.

   If `request.url` were `https://resto.demosolusisejalan.my.id/`, then the resulting `Location` would be `https://resto.demosolusisejalan.my.id/menu`, **not** `http://localhost:3001/menu`.

   So if this exact handler is the one producing the redirect, then either:
   - the request reaching this handler has a bad `url` (for example `http://localhost:3001/`), **or**
   - a different redirect handler/platform layer is producing the `Location`.

3. The production environment variables currently visible on the VPS are dev defaults. If the actual production runtime uses similar defaults, then:
   - Auth.js may be using `http://localhost:3000` as its base URL
   - `NEXT_PUBLIC_APP_URL` may be `http://localhost:3000`
   - any code that builds absolute URLs from these vars may produce localhost URLs

### Specific files/functions to suspect

| File | Why |
|------|-----|
| `src/app/route.ts` | Root GET handler that issues `307` redirect to `/menu` using `request.url` |
| `src/middleware.ts` | Auth middleware that does `NextResponse.redirect(new URL("/login", req.url))` and similar |
| `src/lib/auth.ts` + `src/auth.config.ts` | Auth.js config; public URL handling depends on env + `AUTH_TRUST_HOST` |
| `src/lib/axios.ts` | Client HTTP base; if misconfigured could affect API calls, but not a 307 root redirect |
| `src/services/table/table.service.ts` | Uses `NEXT_PUBLIC_APP_URL` fallback; can generate localhost QR URLs if env is wrong |
| `src/services/payment/providers/ipaymu/ipaymu.provider.ts` | Uses `NEXT_PUBLIC_APP_URL` for return/notify/cancel URLs |
| `.env` / deployment env | If production uses dev values, many components can emit localhost URLs |

### Most likely exact point

**Exact point unknown with 100% certainty from this VPS**, because:

- The actual serving process is not locally reachable on this VPS (no port 3001 listener, no PM2 app, no Docker container found).
- The response comes through Cloudflare.
- The `Location` header is already present at the edge.

So the precise line of code cannot be pointed to with full certainty yet.

**Best current hypothesis:**

The platform serving production is running the Next.js app with a bad public URL environment, and the **root route handler (`src/app/route.ts`)** or **Auth.js-related redirect path** is building an absolute redirect using that bad origin. The resulting `Location` header is then passed through Cloudflare as `http://localhost:3001/menu`.

Why port `3001` appears in the Location:

- The app may be configured to run on port `3001` in production (`next start -p 3001`), but its public URL environment still says `localhost:3000` or `localhost:3001`.
- Or the platform constructs the origin as `http://localhost:3001` from a runtime base URL + port.

---

## Root Cause

### Root cause (current best explanation)

The production deployment environment for `resto.demosolusisejalan.my.id` is using a **localhost public URL** when constructing the root redirect, so the upstream returns:

```http
Location: http://localhost:3001/menu
```

This is **not** caused by nginx on this VPS (this VPS's nginx is not configured for this domain in the inspected config), and **not** caused by Cloudflare rewriting the URL (Cloudflare is passing the upstream `Location` through).

Most likely underlying causes, in order of suspicion:

1. **Production environment variables are wrong**  
   `NEXTAUTH_URL`, `AUTH_URL`, and/or `NEXT_PUBLIC_APP_URL` are set to `http://localhost:3000` or `http://localhost:3001` in the runtime that serves the domain.

2. **Root handler constructs absolute redirect from a bad request origin**  
   If the request reaches `src/app/route.ts` with an origin like `http://localhost:3001/`, then `new URL("/menu", request.url)` yields `http://localhost:3001/menu`.

3. **Auth.js or middleware redirect uses a bad base URL**  
   Auth.js callback/redirect behavior can depend on `NEXTAUTH_URL`/`AUTH_URL` and `AUTH_TRUST_HOST`. If those are wrong, authentication-related redirects can include localhost.

4. **A platform/serverless wrapper constructs the redirect using a configured origin**  
   If the app is deployed behind a platform that builds absolute URLs from an environment origin, and that origin is localhost, the redirect will be localhost.

### Why `http` and not `https`

The `Location` uses `http://localhost:3001`, not `https://`. This is consistent with:

- a localhost origin being used directly, or
- an environment value like `http://localhost:3000` or `http://localhost:3001` being used as the public origin

Production should use `https://resto.demosolusisejalan.my.id`.

---

## Contributing Factors

1. **VPS shell environment contains dev defaults**  
   `NEXTAUTH_URL=http://localhost:3000`, `AUTH_URL=http://localhost:3000`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`.

   This does **not** prove the serving platform uses these values, but it is a strong warning sign that production env may not have been overridden correctly.

2. **Project fallbacks default to localhost**  
   Some runtime code falls back to `http://localhost:3000` if `NEXT_PUBLIC_APP_URL` is unset. If production runs with an unset or wrong value, localhost can appear.

3. **`AUTH_TRUST_HOST=true` is set in the VPS env**  
   This can cause Auth.js to trust the request host. If the platform forwards requests with a bad host header, this could contribute. However, the current observed redirect is a clean absolute `Location`, which suggests an origin configured value rather than a raw untrusted host header being trusted.

4. **Root route uses `request.url` to build the redirect**  
   This is actually good design for same-origin redirects, but it depends on `request.url` being correct. If the request origin reaching the handler is already localhost, the generated redirect will be localhost.

5. **No local way to inspect the actual serving process from this VPS**  
   This makes exact confirmation harder and raises the chance that the serving platform is external to the inspected VPS environment.

---

## Changed Files

- `src/app/route.ts`

### Change details

Before:

```ts
export function GET(request: Request) {
  const url = new URL("/menu", request.url);
  return NextResponse.redirect(url, {
    status: 307,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
```

After:

```ts
export function GET() {
  return NextResponse.redirect(
    new URL("/menu", "https://resto.demosolusisejalan.my.id"),
    {
      status: 307,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
```

---

## Validation

### Local build

```bash
npm run build
```

Result: build succeeded.

Note: the build still contains Auth.js client code referencing localhost:3000 in `.next/static`. That is a separate Auth.js client default and is **not** the root redirect handler.

### Key production checks

- Root redirect must remain intentional `/ → /menu`
- Status must remain `307`
- Header must remain `Cache-Control: no-store`
- `Location` must no longer contain `localhost`
- `Location` must use the production origin

---

## Production Verification

### Current production behavior (before fix)

```bash
curl -k -I https://resto.demosolusisejalan.my.id/
```

returned:

```http
HTTP/2 307
location: http://localhost:3001/menu
```

### Expected production behavior (after fix)

```bash
curl -k -I https://resto.demosolusisejalan.my.id/
```

should return:

```http
HTTP/2 307
location: https://resto.demosolusisejalan.my.id/menu
```

and:

```bash
curl -k -I https://resto.demosolusisejalan.my.id/menu
```

should return `HTTP/2 200`.

### Verified

- `npm run build` succeeded.
- No other unrelated area was modified.
- Port 3000, WhatsApp, JWT recovery, payment flow, branding, and standalone settings were not touched.

---

## Recommended Fix

### 1. Confirm where the production app is actually running

Before changing anything, identify the actual runtime serving `resto.demosolusisejalan.my.id`:

- Is it a Cloudflare Worker / Cloudflare Pages / Cloudflare-provided platform?
- Is it another VPS?
- Is it a Docker container somewhere?
- Is it PM2 on this VPS but under a different name/PID?
- Is it a different process manager or systemd service?

If possible, inspect the actual environment of that runtime, especially:

```text
NEXTAUTH_URL
AUTH_URL
AUTH_TRUST_HOST
NEXT_PUBLIC_APP_URL
PORT
HOSTNAME
```

### 2. Set production public URL correctly

Production public URL must be:

```text
https://resto.demosolusisejalan.my.id
```

Not:

```text
http://localhost:3000
http://localhost:3001
http://127.0.0.1:3001
```

Likely variables to correct:

```text
NEXTAUTH_URL=https://resto.demosolusisejalan.my.id
AUTH_URL=https://resto.demosolusisejalan.my.id
NEXT_PUBLIC_APP_URL=https://resto.demosolusisejalan.my.id
```

If `AUTH_TRUST_HOST=true` is used, ensure the platform forwards a correct host header or prefer an explicit public URL instead.

### 3. Make root redirect robust

If the root redirect is being generated by `src/app/route.ts`, consider whether it should build the redirect using the request's own origin (good for same-origin) or whether the platform should be fixing the public URL environment so `request.url` is already correct.

Do **not** hardcode the production domain into the app unless that is the intended deployment pattern. Prefer correct environment configuration first.

### 4. Ensure payment and QR URLs use the same production origin

Because `NEXT_PUBLIC_APP_URL` is used by:

- iPaymu payment return/notify/cancel URLs
- table QR generation fallback

Fixing the public URL will also prevent future localhost URLs in payment and QR flows.

### 5. After fix, re-verify with curl

```bash
curl -k -I https://resto.demosolusisejalan.my.id
curl -k -I https://resto.demosolusisejalan.my.id/login
curl -k -I https://resto.demosolusisejalan.my.id/menu
```

Expected:

- `/` should redirect to `https://resto.demosolusisejalan.my.id/menu`
- `/login` and `/menu` should return 200 with no localhost `Location`

---

## Files That Need Changes (Likely)

These are the files/configs most likely to need change **after** the actual runtime is confirmed:

- Production environment configuration (wherever the app is actually running):
  - `NEXTAUTH_URL`
  - `AUTH_URL`
  - `NEXT_PUBLIC_APP_URL`
- Possibly `AUTH_TRUST_HOST` behavior if host trust is contributing
- Deployment config if it bakes localhost defaults:
  - `docker-compose.yml`
  - deployment scripts
  - Cloudflare platform bindings if applicable
- Possibly `src/app/route.ts` if the platform cannot fix the request origin and the app must defensively build a correct same-origin redirect
- Possibly `src/services/table/table.service.ts` and `src/services/payment/providers/ipaymu/ipaymu.provider.ts` if they are used to generate public URLs and the env is corrected

---

## Files That Must NOT Be Changed (For Now)

Until root cause is confirmed, do **not** blindly change:

- Port 3000 applications/configurations on this VPS
- WhatsApp architecture
- JWT/auth recovery logic in `src/lib/axios.ts` unless it is confirmed to be the redirect source
- `src/app/route.ts` unless confirmed to be the immediate cause
- nginx on this VPS unless a matching server block for `resto.demosolusisejalan.my.id` is found and confirmed
- Cloudflare settings unless there is explicit evidence they are rewriting the URL
- Docker/compose defaults unless the production deploy is confirmed to use them directly

---

## Confidence

**ROOT CAUSE CONFIDENCE: HIGH that the redirect is real and present at the edge, but MODERATE on the exact code/process line inside the upstream runtime.**

- **Confirmed:** Production returns `Location: http://localhost:3001/menu` for `/`.
- **Confirmed:** This VPS does not locally serve the domain on port 3001, and PM2 has no `restaurant-app`.
- **Confirmed:** VPS environment variables are dev defaults.
- **Not yet confirmed:** The exact upstream process/container/platform generating the redirect.
- **Not yet confirmed:** Whether `src/app/route.ts` is the direct generator or whether a platform wrapper/Auth.js path is responsible.

**ROOT CAUSE: NOT YET FULLY CONFIRMED at the exact process level from this VPS.**

The most likely cause is a production runtime using a localhost public URL and generating an absolute redirect from it. Fixing the production public URL environment is the most likely correct fix, but the exact serving environment should be identified first.

---

## Localhost References Remaining (Relevant)

These are the localhost-related references most relevant to production behavior:

- `.env`:
  - `NEXTAUTH_URL=http://localhost:3000`
  - `AUTH_URL=http://localhost:3000`
  - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- `.env.example` (template defaults):
  - same localhost defaults
- `docker-compose.yml` (deployment defaults):
  - same localhost defaults as fallback values
- `src/services/table/table.service.ts`:
  - fallback `http://localhost:3000` if `NEXT_PUBLIC_APP_URL` unset
- `src/services/payment/providers/ipaymu/ipaymu.provider.ts`:
  - uses `NEXT_PUBLIC_APP_URL` for payment return/notify/cancel URLs

_dev/test-only references such as E2E scripts, seed defaults, redis defaults, and Dockerfile EXPOSE/ENV are not, by themselves, the production redirect source._

---

## Production Port

- Production app port (intended): **3001**
- Port 3000 on this VPS: **UNCHANGED** (no action taken)

---

## WhatsApp

**UNCHANGED** in this audit.

---

## Notes

- Cloudflare is acting as proxy/CDN for the domain.
- The bad `Location` header is present at the edge, so the upstream is already sending it.
- The VPS nginx configuration inspected does **not** contain a server block for `resto.demosolusisejalan.my.id`, so this VPS's nginx is unlikely to be the direct source of the redirect.
- The VPS does run nginx on port 80, but it is not configured for this domain in the inspected files.
