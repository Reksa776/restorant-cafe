# Restaurant / Cafe Management & Ordering App

A Next.js restaurant ordering & management system: customer menu/QR ordering,
QRIS & virtual-account payments (iPaymu), cashier shift management, approvals
(refunds / cancellations / overrides), WhatsApp notifications (Baileys via
BullMQ), product image uploads, and realtime admin dashboards (SSE).

## Stack

| Layer      | Technology |
|------------|------------|
| Framework  | Next.js 16 (App Router, TypeScript) |
| UI         | React 19, Tailwind CSS v4, shadcn-style components |
| Database   | MySQL 8 / MariaDB via Prisma 7 (`@prisma/adapter-mariadb`) |
| Auth       | Auth.js / NextAuth v5 (Credentials, JWT strategy) |
| HTTP       | Axios (client), fetch (server) |
| Queues     | BullMQ + Redis (WhatsApp worker) |
| Payments   | iPaymu v2 (VA + QRIS), HMAC-signed webhook |
| WhatsApp   | Baileys (per-restaurant sessions) |
| Realtime   | Server-Sent Events (in-memory bus, single instance) |
| Runtime    | Node >= 20.9 (`next start`, PM2) |

## Environment variables

Copy `.env.example` to `.env` and fill in the values (never commit `.env`):

- `DATABASE_URL` — MySQL connection string
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (or `AUTH_URL`), `AUTH_TRUST_HOST`
- `NEXT_PUBLIC_APP_URL` — public HTTPS origin (used for the iPaymu webhook /
  return URLs — MUST be the real domain in production)
- `IPAYMU_ENV` (`sandbox` | `production`), `IPAYMU_VA`, `IPAYMU_API_KEY`,
  optional `IPAYMU_BASE_URL`
- `REDIS_URL` — BullMQ/WhatsApp queue backend
- `WHATSAPP_SESSION_DIR` — Baileys session storage (legacy
  `WHATSAPP_SESSION_PATH` is honored as an alias)
- `PRODUCT_UPLOAD_DIR` — physical root for product images; defaults to
  `<project>/uploads/products`. In local dev point it outside the watcher,
  e.g. `.runtime-data/uploads/products`
- `BRANDING_UPLOAD_DIR` — physical root for restaurant logo uploads;
  defaults to `<project>/uploads/branding` (same rules as
  `PRODUCT_UPLOAD_DIR`)
- `SEED_CASHIER_PASSWORD` — optional seed-only cashier password

## Development

```bash
npm install          # runs `prisma generate` via postinstall
npm run db:migrate   # apply migrations (prisma migrate dev)
npm run db:seed      # seed restaurant + admin/cashier users
npm run dev          # Next.js dev server (default :3000)
npm run worker:dev   # WhatsApp BullMQ worker (tsx)
```

Note: the seed creates `admin@restobahagia.com` / `admin123` and
`kasir@restobahagia.com` / `kasir123` — change these immediately in any
environment that is not a throwaway local database.

## Database

- Schema: `prisma/schema.prisma`; migrations in `prisma/migrations/`
- Apply to a production DB with **`npm run db:deploy`** — it runs the static
  migration safety preflight (`npm run db:preflight`) and only then
  `prisma migrate deploy`, joined with `&&` (fail-closed).
- Never edit applied migrations; add new timestamped ones.

### Migration safety preflight (STEP 2C.6-C1B)

Prisma 7.10.0 decides the migration **apply order** in the CLI with JavaScript
`String.prototype.localeCompare` (ICU/CLDR collation of the *runtime*), not by
file-name bytes. This chain mixes 8-digit and 14-digit directory prefixes and
carries one cross-migration foreign key, so an order produced by a runtime whose
`localeCompare` is **not** ICU-aware (e.g. Node built `--with-intl=none`) would
fail mid-chain with `P3018` / errno 1146.

`tools/preflight-migrations.mjs` is a **static, fail-closed** gate that runs
before any migration. It opens no database connection, reads/writes no ledger,
runs no SQL and calls no Prisma command. It fails (exit 1) when:

- the ICU collation canary fails on this runtime;
- the effective order differs from `tools/migration-order.baseline.json`;
- a migration directory is missing or unexpected;
- any `migration.sql` sha256 differs from the baseline;
- the installed Prisma version differs from the baseline (**hard fail**).

```bash
npm run db:preflight        # check only (no DB, no writes)
npm run db:deploy           # preflight && prisma migrate deploy
npm run db:baseline:update  # regenerate the baseline (explicit + reviewed only)
```

There is **no bypass/force flag**. A failure means "use a compliant runtime or
fix the tree", never "press on". The baseline is regenerated **only** by an
explicit `npm run db:baseline:update` whose diff must be reviewed in the same
change that adds/edits a migration; it is never updated automatically when a
preflight or deploy fails.

**Paths that do NOT go through the guard** (deliberate, documented — do not
assume otherwise): a manual `npx prisma migrate deploy` typed by hand;
`npm run db:migrate` (`prisma migrate dev`, dev-only and forbidden on a live DB);
`npm run db:push`; and the Docker images, which run **no** migration step at all
(`CMD ["node", "server.js"]`, worker `CMD ["npx", "tsx", ...]`) — provisioning
is a manual operator step. Always use `npm run db:deploy` for provisioning.

## Payments

- QRIS (dine-in) is paid on the in-app `/payment/[orderNumber]` page;
  takeaway/delivery use the legacy iPaymu VA redirect.
- The webhook `POST /api/webhooks/ipaymu` is signature-verified
  (HMAC-SHA256), amount-checked against the order, and idempotent.
- `NEXT_PUBLIC_APP_URL` must be the public HTTPS origin so the gateway can
  reach `https://<domain>/api/webhooks/ipaymu`.

## Product images

- Uploads: `POST /api/admin/uploads/product-image` (ADMIN only, magic-byte
  validated, UUID filenames, max 5 MB).
- Files are stored OUTSIDE `public/` (runtime directory) and served by the
  app route `/uploads/products/[restaurantId]/[filename]`.
- The storage directory (`PRODUCT_UPLOAD_DIR`, default `uploads/products`)
  is LIVE DATA: it must be persisted (volume / host dir) across rebuilds and
  restarts, and is git-ignored.

## Website branding (Admin Settings)

Each restaurant can customize its customer-facing website branding from
Admin → Settings → **Website Branding**:

- **Website name** — overrides `Restaurant.name` on the customer site
  (falls back to the restaurant name when empty).
- **Logo** — PNG/JPEG/WebP, max 2 MB, magic-byte validated, stored under
  `<BRANDING_UPLOAD_DIR>/<restaurantId>/` and served by
  `/uploads/branding/[restaurantId]/[filename]`. Replacing/removing a logo
  deletes the old physical file (path-guarded, tenant-confined).
- **Colors** — strict `#RRGGBB` hex only (validated client- and server-side;
  arbitrary CSS is never applied). Foreground contrast is computed
  automatically so custom themes stay readable.
- Persisted in the `RestaurantSettings` table (one row per restaurant,
  additive migration `20260908_add_restaurant_branding`).
- The customer site (menu header, QR table page, buttons) reads branding
  from `GET /api/public/restaurant` — no extra requests, no stale caching.

## WhatsApp worker

## WhatsApp worker

The WhatsApp send path uses a BullMQ worker:

```bash
npm run worker:dev
```

or via PM2. The queue requires a reachable `REDIS_URL`. WhatsApp connection
lifecycle is managed through the admin UI (`/admin/whatsapp`).

## Realtime

Admin dashboard and customer order pages use SSE. The event bus is
in-memory — PM2 must run the app as a SINGLE instance (`next start -p 3001`).
If the app is ever scaled to multiple Node processes, back the bus with Redis
pub/sub (see `src/lib/realtime/bus.ts`).

## Production (VPS)

- Build: `npm run build`; run with `next start -p 3001` under PM2.
- Reverse proxy (Apache/Cloudflare) terminates TLS and proxies to `:3001`;
  `X-Forwarded-*` headers must be set (SSE needs `X-Accel-Buffering: no`).
- Apply migrations before starting the new build — use **`npm run db:deploy`**
  (it runs `npm run db:preflight` first and stops on any failure). Do not run a
  raw `npx prisma migrate deploy` on this host: that path is not guarded.
- Port 3000 is reserved for other applications on the same host — do not
  bind the restaurant app there.

## Tests

TypeScript: `npx tsc --noEmit`

Browser E2E scripts live in `scripts/e2e-*.mjs` (Puppeteer). They run
against a local dev server and database; see each script's header comments.