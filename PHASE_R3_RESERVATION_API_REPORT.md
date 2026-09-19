# PHASE R3 — RESERVATION HTTP / API ROUTE LAYER

**Phase:** R3 — Reservation public + admin API routes
**Status:** ✅ COMPLETE — all verification green
**Completeness: 100%** — VERDICT: PASS

---

## 1. Phase Summary

Implemented the full HTTP route layer for reservations on top of the R1/R2
`ReservationService`. Two families of endpoints:

- **Public** (`/api/public/reservations*`) — guest booking, guest self-service
  lookup, and slot availability for the customer website / QR flow. No
  authentication required; rate limited; restaurant scoped via a
  shared server-side resolver (never the raw client).
- **Admin** (`/api/admin/reservations*`) — list, create, detail (by id and by
  code), availability, status transitions and cancellation for the kasir/admin
  board. Always tenant + branch scoped through the existing
  `requireRoles`/`authorizedBranches`/`assertBranchInScope` server model.

All business logic (booking window, capacity, conflicts, transitions, code
generation, concurrency) stays in the R2 service. The routes only authenticate,
rate-limit, validate request shape, resolve the server-side context, and map
`AppError`s to the app's standard response envelope.

> **Testing note — "Full Jest suite".** The repository has no Jest/Vitest/Next
> test tooling. Route handlers call `auth()` (NextAuth), which requires the
> real Next request scope, so the R3 suite bootstraps a real `next dev` server
> and exercises every endpoint over HTTP. "Full suite" is interpreted as **all
> existing `node:test` suites** (6 files) — all run green (see §11).

---

## 2. Files Added / Modified

**New — public routes**
- `src/app/api/public/reservations/route.ts` — `POST` create (rate limited 30/min)
- `src/app/api/public/reservations/[code]/route.ts` — `GET` guest lookup (120/min)
- `src/app/api/public/reservations/availability/route.ts` — `GET` availability (240/min)
- `src/app/api/public/reservations/_resolve-public-context.ts` — shared tenant resolver
- `src/app/api/public/reservations/_public-dto.ts` — public-safe DTO mapper

**New — admin routes**
- `src/app/api/admin/reservations/route.ts` — `GET` list (paginated, filtered) + `POST` create
- `src/app/api/admin/reservations/[id]/route.ts` — `GET` detail by internal id
- `src/app/api/admin/reservations/code/[code]/route.ts` — `GET` detail by code
- `src/app/api/admin/reservations/availability/route.ts` — `GET` availability by branchId
- `src/app/api/admin/reservations/[id]/status/route.ts` — `PATCH` status transition
- `src/app/api/admin/reservations/[id]/cancel/route.ts` — `POST` cancel

**New — tests**
- `src/services/reservation/reservation.api.test.ts` — 30 HTTP security tests
  (placed outside `src/app` so the Next build never treats it as a route)

**Modified**
- `src/services/reservation/reservation.types.ts` — `ReservationAvailabilityQuerySchema`
  gained coerced `startMinutes` + `durationMinutes`; new
  `ReservationAdminAvailabilityQuerySchema` and `ReservationCancelSchema`.

---

## 3. Route Inventory & Contract

| Endpoint | Auth | Rate limit | Success | Errors |
|---|---|---|---|---|
| `POST /api/public/reservations` | guest | 30/60s | **201** `{code,status,...}` | 400/404/409 |
| `GET /api/public/reservations/[code]` | guest | 120/60s | **200** safe DTO | 400/404 |
| `GET /api/public/reservations/availability` | guest | 240/60s | **200** `{tables:[...]}` | 400/404 |
| `GET /api/admin/reservations?page&limit&branchId&...` | ADMIN/CASHIER | — | **200** `{items,total,page,limit,totalPages}` | 400/401/403 |
| `POST /api/admin/reservations` | ADMIN/CASHIER | — | **201** `ReservationView` | 400/401/403 |
| `GET /api/admin/reservations/[id]` | ADMIN/CASHIER | — | **200** `ReservationView` | 401/403/404 |
| `GET /api/admin/reservations/code/[code]` | ADMIN/CASHIER | — | **200** `ReservationView` | 400/401/403/404 |
| `GET /api/admin/reservations/availability?branchId&date&partySize&startMinutes&...` | ADMIN/CASHIER | — | **200** `{tables:[...]}` | 400/401/403 |
| `PATCH /api/admin/reservations/[id]/status` | ADMIN/CASHIER | — | **200** `ReservationView` | 400/401/403/404/409 |
| `POST /api/admin/reservations/[id]/cancel` | ADMIN/CASHIER | — | **200** `ReservationView` | 400/401/403/404/409 |

Static segments (`availability`, `code/[code]`) take precedence over the
dynamic `[id]`, so the three read paths are unambiguous.

**Error contract** (existing app envelope, zero leaks): `400 VALIDATION_ERROR`,
`401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`;
anything unexpected → `500 INTERNAL_ERROR` with a fixed Indonesian message and
the stack only in server logs.

---

## 4. Restaurant / Tenant Resolution (public routes)

Shared `resolvePublicReservationRestaurant`, mirroring the app's own
`POST /api/public/orders` convention — the client NEVER dictates the tenant:

1. `tableId` wins — server-validated via Prisma (invalid/inactive table → 400).
2. Authenticated customer-session restaurant (only if ACTIVE).
3. Client-claimed `restaurantId` — only when it maps to an ACTIVE restaurant.
4. Legacy fallback: first active restaurant (kept for the pre-existing public
   site; in this environment it is non-deterministic, so the R3 tests always
   pass a `tableId` or a valid `restaurantId`).

Public availability also resolves the branch *under the resolved restaurant*
via `branchService.findBranchByCode`, so a `branchCode` belonging to another
tenant never resolves (404).

---

## 5. Authorization Model (admin routes)

- `branchHintFrom(request)` reads the `x-branch-id` header (server-validated).
- `requireRoles(["ADMIN","CASHIER"], hint)` → `AuthenticatedContext` with
  `restaurantId`, `branchIds`, `branchScoped`, `branchId`.
- **All reads** pass `authorizedBranches(ctx)` as `branchFilters` to the R2
  service — a branch-scoped staff member is structurally limited to their own
  branches; a non-scoped user sees the whole restaurant.
- **Admin create** validates the body `branchId` with `assertBranchInScope`
  before the service call — a tenant-crossing or out-of-scope branch is rejected
  (403) before any write.
- **Admin availability** validates `branchId` with `assertBranchInScope` — no
  cross-branch capacity probing.
- Sessions are real Auth.js v5 JWT sessions (password → bcryptjs compare),
  checked per request against the DB (role/isActive/sessionVersion).

---

## 6. Validation

- All bodies parsed with `safeParse` against the R1/R2 Zod schemas →
  `ValidationError(message)` → **400**.
- Query param availability schemas `z.coerce` numbers (`partySize`,
  `startMinutes`, `durationMinutes`) because URL params are strings; the
  service re-validates everything authoritatively.
- New `ReservationCancelSchema` (`{ cancelReason?: string|null }`, ≤200 chars)
  keeps the cancel entry point independent from the PATCH status schema.

---

## 7. Response / Public DTO

- Public create returns an **explicit allow-list DTO** (id, code, status, date,
  start/duration minutes, partySize, guestName, guestPhone, `branch:{code,name}`,
  `table:{number,name}`, createdAt) — never `customerId`, `orderId`, `source`,
  `notes`, or internal ids. Verified by the `assertNoInternalFields` helper.
- Guest lookup returns the R2 service's already-safe projection.
- Admin endpoints return the full `ReservationView` (internal consumers).

---

## 8. Rate Limiting

- `assertRateLimit(rateLimitKey(...), N, 60_000)` on all three public routes
  (create 30, lookup 120, availability 240 per IP/minute), reusing the app's
  existing in-memory limiter. Not exhaustively exercised (would need 30+
  sequential creates) — code-level assertion + the single-instance limiter
  contract in place.

---

## 9. Security Verification Matrix (spec's ~20 checks → test IDs)

| # | Security check | Test | Result |
|---|---|---|---|
| 1 | Create happy path returns safe public DTO (no internal fields) | `P1` | ✅ 201, DTO allow-list clean |
| 2 | Missing/invalid required fields → 400 | `P3`, `A4` | ✅ |
| 3 | Invalid / fake `tableId` rejected server-side | `P5` | ✅ 400 |
| 4 | Unavailable slot → 409 (capacity conflict) | `P2` | ✅ |
| 5 | Past date rejected | `P4` | ✅ 400 |
| 6 | Unauthenticated admin access → 401 on all 4 verbs | `A1` | ✅ |
| 7 | Cross-tenant read / status / cancel → 404 | `A5-A7` | ✅ |
| 8 | Branch scope: own branch create+read 200, other branch create 403 / read 404 | `A8-A10` | ✅ |
| 9 | Tenant-crossing `branchId` in create → 403 | `A3` | ✅ |
| 10 | Tenant-crossing `branchCode` (public create + availability) → 404 | `P6`, `P14` | ✅ |
| 11 | Guest lookup with wrong phone → 404 | `P9` | ✅ |
| 12 | Guest lookup of another tenant's code → 404 | `P11` | ✅ |
| 13 | Pagination + branch param windowing on list | `A11` | ✅ |
| 14 | Admin lookup by non-sequential code | `A12` | ✅ |
| 15 | Status transition chain + terminal-state 409 | `A14` | ✅ |
| 16 | Cancel with reason echoes cancelReason | `A15` | ✅ |
| 17 | Availability happy path + invalid input + cross-tenant | `P12-P14`, `A13` | ✅ |
| 18 | Unexpected error → generic 500, no stack leak | `P7` | ✅ |
| 19 | Rate limiting present on all public write/read routes | code-level (§8) | ✅ |
| 20 | **Concurrent identical creates → exactly one winner** | `A16` | ✅ 1×201 / 4×409 |

---

## 10. Test Strategy

Route handlers cannot run under `tsx` (`auth()` needs Next's request scope), so
`reservation.api.test.ts`:

1. Kills any stale dev server (Next refuses a second instance per project dir).
2. Spawns a real `next dev -p <ephemeral-port>` child; polls
   `/api/public/restaurant` until ready.
3. Seeds isolated fixtures (restA/restB, branches MAIN/ALT/R2B, tables,
   adminA all-branch, adminB cross-tenant, cashierC scoped to ALT).
4. Signs in over real HTTP (`/api/auth/csrf` → `/api/auth/callback/credentials`)
   and reuses the session cookies.
5. Runs 30 tests; tears fixtures down and kills the server in `after()`.

---

## 11. Test Results (final run)

| Suite | Tests | Result |
|---|---|---|
| R1 unit (`reservation.unit.test.ts`) | 41 | ✅ 41/41 |
| R2 integration (`reservation.service.test.ts`) | 41 | ✅ 41/41 |
| **R3 HTTP API (`reservation.api.test.ts`)** | **30** | ✅ **30/30** |
| Simulation (`simulation.unit.test.ts`) | 20 | ✅ 20/20 |
| Menu engineering (`menu-engineering.classify.unit.test.ts`) | 23 | ✅ 23/23 |
| Costing (`historical-snapshot.unit.test.ts`) | 8 | ✅ 8/8 |
| **Total** | **163** | ✅ 163/163 |

- `npx tsc --noEmit` — **0 errors**
- `npx eslint` (reservation + new route dirs) — **0 errors, 0 warnings**
- `npx next build` — **successful**; all 9 reservation routes compile and are
  listed in the route manifest.
- DB **clean** after every run — 0 leftover R3 fixture rows; no zombie dev
  servers left behind.

---

## 12. Deviations & Decisions

- **Cancel returns 200** (not 201): cancel is a semantic status transition to
  CANCELLED, consistent with the PATCH status flow. The older
  `purchases/[id]/cancel` uses 201 but predates these shared conventions.
- **`z.coerce` added to the availability query schema** — URL params are
  strings; the previous schema only accepted numbers (fine at the service-layer
  boundary, wrong at the HTTP boundary). Re-validated by the service regardless.
- **`startMinutes` (and `durationMinutes`) added to availability** — the R2
  `checkAvailability` kernel requires an explicit start slot.
- **No open-shift guard** on reservation create: reservations are not money
  movements, and the R1/R2 flow has no shift requirement for PENDING bookings.
- **"Another next dev server is already running"** (Next 16 lock): the harness
  kills any stale dev server before spawning its own.

---

## 13. Constraints Honored (what was NOT done)

- No Prisma writes/reads of reservation data in the routes — everything
  delegates to the R2 service (R2 concurrency kernel untouched).
- No duplicated R1/R2 business logic (window/capacity/conflict/transitions).
- No WhatsApp / realtime / reminders / cron / analytics / payments / order
  integration.
- No destructive DB changes — `schema.prisma` and the R1 migration untouched.
- No commits, no pushes, no history changes — working tree left with the
  implementation only.

---

## 14. Known Limitations

- R3 boot-time for the API suite is ~4–6s (dev-server cold start); whole run
  ~16s. Requires a reachable `DATABASE_URL` and `NEXTAUTH_SECRET`.
- Dev-server boot is single-instance per project dir; concurrent `next dev`
  on this repo can conflict.
- Rate-limit thresholds are not exhaustively hammered in tests (would compete
  with the create bucket); the guards are present and exercised implicitly.
- The public "first active restaurant" fallback is deterministic only in a
  single-tenant deployment (kept to match the legacy public site).

---

## 15. How to Run

```bash
# R3 HTTP API suite (spawns its own next dev server)
npx tsx --test src/services/reservation/reservation.api.test.ts

# R1 + R2 suites (must stay green)
npx tsx --test src/services/reservation/reservation.unit.test.ts
npx tsx --test src/services/reservation/reservation.service.test.ts

# Other suites
npx tsx --test src/services/simulation/simulation.unit.test.ts
npx tsx --test src/services/menu-engineering/menu-engineering.classify.unit.test.ts
npx tsx --test src/services/costing/historical-snapshot.unit.test.ts

# Static checks
npx tsc --noEmit
npx eslint src/services/reservation src/app/api/public/reservations src/app/api/admin/reservations
npx next build
```

---

## 16. Next Steps / Suggestions

- Wire the kasir/admin frontend to the admin endpoints and the public website
  to the public endpoints (QR `t/[...tSegment]` flow).
- Consider a dedicated rate-limit test using a throwaway bucket once a
  configurable limiter exists.
- Optional: expose `GET /api/admin/reservations/[id]/availability` adjustments
  for the board's drag-reschedule UX (needs new service method first).

---

**VERDICT: PASS — Phase R3 delivered: 10 HTTP verbs across 9 routes, 30
HTTP security tests green, all 163 suites green, tsc/eslint/build clean, no
schema changes, no leaks, no commits.**