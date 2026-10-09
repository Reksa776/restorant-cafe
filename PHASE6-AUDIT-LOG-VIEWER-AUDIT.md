# PHASE 6 — AUDIT LOG VIEWER AUDIT

**Mode:** AUDIT ONLY — no source change, no migration, no schema change, no DB change, no dependency, no commit, no push, no deploy.
**HEAD at audit time:** `d7f29ac` (PHASE 5B untouched)
**Audited at:** 2026-10-08, local dev DB (`mysql://…@localhost:3306/restaurant_app`), 44 `auditlog` rows in 1 tenant.

> **Source of truth = the actual codebase.** The supplied context ("`auditService.list()` sudah ada tetapi **belum memiliki UI viewer/admin page yang proper**") is **OUTDATED**. The audit-log viewer already exists end-to-end: admin page, API route, client wrapper, navigation entry, and a service test. This audit therefore became a **maturity/gap audit of an existing feature**, not a greenfield design.

---

## 1. Executive Summary

| Layer | Status | Evidence |
|---|---|---|
| `AuditLog` model (Prisma) | **EXISTS** | `prisma/schema.prisma:522-544`, `@@map("auditlog")`, 5 indexes |
| Writers (audit events) | **EXISTS** | 20 call sites across 6 domains |
| `auditService.log()` | **EXISTS** | `src/services/audit/audit.service.ts` (best-effort, never throws) |
| `auditService.list()` | **EXISTS** | server-side pagination + 9 filters + tenant/branch scoping |
| `auditService.getById()` | **EXISTS but unused by the API** | test-only; there is no `[id]` route |
| `GET /api/admin/audit-logs` | **EXISTS** | `src/app/api/admin/audit-logs/route.ts`, ADMIN-only |
| Client wrapper | **EXISTS** | `src/services/audit.service.ts` (browser-safe, axios) |
| Admin page `/admin/audit-logs` | **EXISTS** | `src/app/admin/audit-logs/page.tsx` (557 lines: filters, table, skeleton, empty/error state, pagination, detail dialog) |
| Admin navigation | **EXISTS** | `src/app/admin/layout.tsx:172` (`roles: ["ADMIN"]`) |
| Service test | **EXISTS** | `src/services/audit/audit.service.test.ts` (node:test, real DB) |
| DB migration needed | **NO** | model + indexes already migrated |

**Runtime verification performed in this phase (read-only): 43/43 probe assertions PASS + 6/6 redaction checks PASS. DB byte-count identical before/after (orders 35, payments 46, paymentTransactions 29, refunds 2, auditLogs 44, users 4, cashierShifts 7).**

**Headline findings (all GAPs, none implemented):**

1. **GAP-IP — `ipAddress` is dead: 44/44 rows NULL.** The column, the `log()` parameter, the DTO field and the detail-dialog row all exist, but **no caller ever passes it**, and no request→service IP plumbing exists. The reusable primitive `clientIp(request)` already exists in `src/lib/rate-limit.ts:76`.
2. **GAP-BRANCHLESS — branch-less rows are invisible to a branch-scoped ADMIN.** `USER_CREATED`/`USER_ACTIVATED`/`USER_DEACTIVATED`/`USER_BRANCH_UPDATED` write `branchId = null` (exactly the 5 NULL-branch rows in the DB). `list()` applies `branchId: { in: branchFilters }`, so those rows never appear for a branch-scoped admin, with no UI hint.
3. **GAP-FILTER-UX — "Action" and "Actor" filters are raw text boxes with exact-equality semantics.** `action=PAYMENT` → **0 rows**, `action=payment_received` → 10 rows (MySQL ci collation). Target spec asks for an Action/User picker.
4. **GAP-SEARCH — free-text `search` covers `action`/`entityType`/`entityId` only**; `search=ORD-20260911-02065X` (an order number that lives in `details`) → **0 rows**.
5. **GAP-DETAILS-IN-LIST — the full `details` JSON + actor email ship in every list row** because the detail dialog reads the list item (no per-row fetch). `getById()`/an `[id]` route would let the list return a slim DTO.
6. **GAP-PII — `USER_CREATED` details expose staff `email` + `role` + `name` verbatim** (verified via API: `{"email":"asep@restobahagia.com","role":"CASHIER","name":"asep"}`). Redaction only masks credential-like **keys**; `email` is deliberately not in the sensitive list.
7. **GAP-DATE — no cross-field date validation**: `dateFrom > dateTo` → HTTP 200 with `total: 0` (silent).
8. **GAP-IP-COL — the table has no IP column** (target table asks for one); target spec's `IP Address` only appears inside the dialog.
9. **GAP-INDEX — no composite `[restaurantId, createdAt]` index**; `EXPLAIN` shows the optimizer picks `auditlog_createdAt_idx` with `Using where`, and the action filter adds **`Using filesort`**.
10. **GAP-PAGE-GUARD — the page has no server-side role guard**; `middleware.ts` matches `/admin/:path*` for auth only. A CASHIER loading `/admin/audit-logs` gets the page shell and an error state (API 403) — **no data leak**, verified.

**Bottom line:** the requested viewer is essentially already built and is authorization-correct (ADMIN-only, tenant-scoped, branch-scoped, read-only). PHASE 6 implementation should be **small gap-closing only** — see §14.

---

## 2. Existing Functionality

### 2.1 Layer map

| Layer | File | Key API | Notes |
|---|---|---|---|
| Schema | `prisma/schema.prisma:522-544` | `model AuditLog` | `@@map("auditlog")`, relations to `Restaurant`/`User` |
| Service (server) | `src/services/audit/audit.service.ts` | `auditService.log()`, `.list()`, `.getById()`, `redactAuditDetails()` | Prisma; `log()` never throws |
| Validation | `src/services/audit/audit.types.ts` | `AuditLogListQuerySchema` (Zod v4) | coerce + clamp `limit ≤ 100`, `page ≥ 1`, strict `YYYY-MM-DD` |
| API | `src/app/api/admin/audit-logs/route.ts` | `GET` | `requireAdmin(branchHintFrom(request))` + `authorizedBranches(ctx)` |
| Client | `src/services/audit.service.ts` | `auditLogService.list()` | axios `GET /admin/audit-logs`; **separate file tree from the Prisma service on purpose** |
| Page | `src/app/admin/audit-logs/page.tsx` | `AuditLogsPage` | filters (search/action/entity/entityId/userId/branch/dateFrom/dateTo), table, skeleton, empty, error, pagination, detail dialog |
| Navigation | `src/app/admin/layout.tsx:172` | `{ name: "Audit Logs", href: "/admin/audit-logs", icon: ClipboardList, roles: ["ADMIN"] }` | nested under the **Settings** group |
| Test | `src/services/audit/audit.service.test.ts` | `node:test` | 8 tests: DTO, filters, date range, search, branch isolation, pagination, redaction, ordering, `getById` scoping |

### 2.2 Write path semantics

* **Where:** every one of the 20 writers calls `auditService.log(...)` **after** the business mutation (post-commit). Verified: `approval` (tx at 191→log 248, 379→544, 602→642, 695→834), `payment` (tx at 725 → log 811, explicitly commented *"best-effort, after the write commits"*), `menu` (tx closes before log 344), `shift` (log after the create/retry loop).
* **Failure isolation:** `log()` wraps `prisma.auditLog.create` in `try/catch` and only `console.error`s → **an audit failure can never fail or roll back the business transaction**. Cost of that choice: a lost audit row is silent.
* **Atomicity:** because the audit write uses the **global** `prisma` client (not a `tx`), it is *never* part of the surrounding transaction. No writer currently calls it inside an open tx, so there is no rollback-orphan risk today — but this is a latent trap if a future writer moves the call inside a `$transaction` callback.
* **Before/after:** there is **no generic before/after diff**. Writers hand-pick fields; only branch-product/stock writers include an "old" value (`oldStock`).
* **Always present:** `restaurantId`, `action`, `createdAt` (DB `@default(now())`). Optional: `branchId`, `userId`, `entityType`, `entityId`, `details`, `ipAddress`.
* **Timestamp quality:** DB-generated `createdAt` (`@default(now())`), stored UTC; the API returns ISO strings and the UI formats with `toLocaleString("id-ID")`. Date filters use **local-day** bounds (`T00:00:00.000` / `T23:59:59.999`) — a documented, intentional semantic.
* **Read set (verified live):** 44 rows, 1 tenant, `userId` NULL = 0, `branchId` NULL = 5, `ipAddress` NULL = **44**, `details` NULL = 0, `entityId` NULL = 0.

---

## 3. Existing Audit Events

`·` = parameter not passed by the writer. "IP" is `—` for **all** rows.

| Domain | Action | Entity | Actor (`userId`) | Tenant | Branch | Details | IP |
|---|---|---|---|---|---|---|---|
| payment | `PAYMENT_RECEIVED` | `Payment/<id>` | `changedBy` | `restaurantId` | `payment.branchId ‖ branchFilters[0]` | orderNumber, amount, amountReceived, changeAmount, method, shiftId, processedBy | — |
| approval | `REFUND_REQUESTED` | `Refund/<id>` | `input.userId` | `input.restaurantId` | `order.branchId` | orderNumber, amount, reason, shiftId, itemAllocations | — |
| approval | `REFUND_APPROVED` \| `REFUND_DENIED` | `Refund/<id>` | `input.adminId` | ✔ | `refund.branchId` | orderNumber, amount, reason, decisionNote | — |
| approval | `CANCELLATION_REQUESTED` | `CancellationRequest/<id>` | `input.userId` | ✔ | `order.branchId` | orderNumber | — |
| approval | `ORDER_CANCELLED` \| `CANCELLATION_REJECTED` | `CancellationRequest/<id>` | `input.adminId` | ✔ | `request.branchId` | orderNumber, reason, decisionNote | — |
| shift | `SHIFT_OPENED` | `CashierShift/<id>` | `input.userId` | ✔ | `resolvedBranchId` | shiftNumber, openingCash | — |
| shift | `SHIFT_CLOSED` | `CashierShift/<id>` | `input.userId` | ✔ | `shift.branchId ?? input.branchId` | shiftNumber, openingCash, cashSales, refunds, expectedCash, closingCash, difference | — |
| shift | `SHIFT_OVERRIDE_REQUESTED` | `ShiftOverride/<id>` | `input.userId` | ✔ | `shift.branchId` | shiftNumber | — |
| shift | `SHIFT_OVERRIDE_APPROVED` \| `…_REJECTED` | `ShiftOverride/<id>` | `input.adminId` | ✔ | `override.shift.branchId` | shiftNumber, reason, decisionNote, proposedClosingCash | — |
| shift | `SHIFT_REOPENED` | `CashierShift/<id>` | `input.adminId` | ✔ | `shift.branchId` | shiftNumber | — |
| branch | `BRANCH_CREATED` | `Branch/<id>` | `input.userId` | ✔ | `branch.id` | *(empty)* | — |
| branch | `BRANCH_UPDATED` | `Branch/<id>` | `userId` | ✔ | `updated.id` | name ‖ code | — |
| branch | `BRANCH_ACTIVATED` \| `BRANCH_DEACTIVATED` | `Branch/<id>` | `userId` | ✔ | `updated.id` | *(empty)* | — |
| branch | `USER_BRANCH_UPDATED` | `User/<id>` | `adminId` | ✔ | **null** | branchIds | — |
| branch | `BRANCH_PRODUCT_UPDATED` | `BranchProduct/<id>` | `userId` | ✔ | `branchId` | isAvailable, priceOverride, stock, oldStock, stockChanged, reason, costingMode, manualHpp | — |
| menu | `BRANCH_PRODUCT_CREATED` | `BranchProduct/<id>` | `options.userId` | ✔ | `options.branchId` | productId, name, isAvailable, priceOverride, stock | — |
| user | `USER_CREATED` | `User/<id>` | `input.adminId` | ✔ | **null** | email, role, name *(PII)* | — |
| user | `USER_ACTIVATED` \| `USER_DEACTIVATED` | `User/<id>` | `input.adminId` | ✔ | **null** | email, role *(PII)* | — |
| user | `PASSWORD_CHANGED` | `User/<id>` | `input.userId` | ✔ | **null** | *(empty — no hash, no password)* | — |

**Observed distribution (44 rows):** `BRANCH_PRODUCT_UPDATED` 10, `PAYMENT_RECEIVED` 10, `SHIFT_OPENED` 7, `SHIFT_CLOSED` 6, `USER_BRANCH_UPDATED` 3, `REFUND_REQUESTED` 2, `USER_CREATED` 2, `REFUND_APPROVED` 1, `SHIFT_OVERRIDE_REQUESTED` 1, `SHIFT_OVERRIDE_APPROVED` 1, `BRANCH_CREATED` 1.
**Entities:** BranchProduct 10, CashierShift 13, Payment 10, Refund 3, ShiftOverride 2, User 5, Branch 1.

**Actor coverage (CORRECTED 2026-10-08 — PHASE 6B):** "GAP-ACTOR" was a **false positive** in the original audit. The 4 writer blocks at `branch.service.ts:128`, `:169`, `:209`, `:503` DO pass the actor, using the **shorthand property** `userId,` (which the audit's field-extraction regex, matching only `userId:`, failed to see). Confirmed twice: the live DB has **0 / 44 rows with `userId = NULL`** (including every `BRANCH_*` action), and the callers pass the server-session id (`ctx.userId`) — never a client body. **No writer omits the actor; no code change was required.** The `branchId` values for those three rows are also non-null (`updated.id` / `branchId`), which was mis-transcribed as `·`.

**Domains with NO audit logging (out of scope, noted):** order status changes, promo/coupon mutations, reservation create/cancel (PHASE 2/3), payment provider webhooks, branding/settings changes, table/layout edits, ingredient stock adjustments, whatsapp connect/disconnect. Reservation writes emit WhatsApp notifications but no audit rows. Not a PHASE 6 defect — that is the pre-existing logging coverage.

**Integrity check (verified in DB):** 0 rows whose `branchId` belongs to a different restaurant; 0 rows whose `userId` belongs to a different restaurant.

---

## 4. AuditLog Schema

```prisma
model AuditLog {
  id           String   @id @default(cuid())
  restaurantId String
  branchId     String?
  userId       String?
  action       String
  entityType   String?
  entityId     String?
  details      Json?
  ipAddress    String?
  createdAt    DateTime @default(now())

  restaurant Restaurant? @relation(fields: [restaurantId], references: [id])
  user       User?       @relation(fields: [userId], references: [id])

  @@index([restaurantId])
  @@index([branchId])
  @@index([userId])
  @@index([action])
  @@index([createdAt])

  @@map("auditlog")
}
```

* **No `branch` relation** — the service resolves branch display names with an explicit batched `prisma.branch.findMany({ where: { id: { in: [...] } } })` in `toViews()`. That is 1 extra query per page, **not** N+1. Consequence: `branchId` is a *soft* reference (no FK), so a deleted branch leaves a dangling id → `branch: null` in the DTO.
* **`restaurantId` has an FK to `Restaurant` but the relation field is optional (`Restaurant?`) with a required `restaurantId`** — same pattern as the rest of the schema.
* Live indexes (via `SHOW INDEX`): `PRIMARY`, `auditlog_restaurantId_idx`, `auditlog_userId_idx`, `auditlog_action_idx`, `auditlog_createdAt_idx`, `auditlog_branchId_idx`.
* **No `updatedAt`/`deletedAt`** → the table is append-only by design; nothing in the codebase updates or deletes audit rows (verified: the only `auditLog.create` is inside the service; the only `deleteMany` is test cleanup).

---

## 5. `auditService.list()` Analysis

Signature: `list(restaurantId, rawQuery, branchFilters?) → { items, total, page, limit, totalPages }`.

| Aspect | Implementation | Verdict |
|---|---|---|
| Page / limit | `z.coerce.number().int().min(1)` / `.min(1).max(100)`, defaults `1` / `25` | **OK** — runtime: `limit=500` → HTTP 400, `page=0` → HTTP 400 |
| `total` | `prisma.auditLog.count({ where })` — same `where` as the page | **OK**, but one extra count query per request |
| `totalPages` | `Math.ceil(total / limit)` | **OK** (runtime: 44/3 → 15) |
| Ordering | `orderBy: { createdAt: "desc" }` | **OK**, fixed; no caller-controlled sort |
| Tenant | `where.restaurantId = restaurantId` — **argument only**, never from the query string | **OK** (runtime: other tenant → `total 0`) |
| Branch | explicit `branchId` must be inside `branchFilters`, else `ForbiddenError`; otherwise `branchId: { in: branchFilters }` | **OK** (runtime: foreign branch → `Forbidden`) |
| Filters | `action`, `entityType`, `entityId`, `userId`, `branchId`, `dateFrom`, `dateTo`, `search` | OK, see gaps |
| `search` | `OR [action, entityType, entityId] contains` | **GAP**: no `details`, no actor name/email |
| Date range | local-day bounds; **no `dateFrom ≤ dateTo` check** | **GAP** (silent empty page) |
| Secrets | `toViews()` → `redactAuditDetails()` on every `details` | **OK** (see §10) |
| Unrestricted / fetch-all | `take` is always clamped to ≤ 100; `skip` derived from validated page | **None found** |
| Relations | `include: { user: select 4 fields }` + 1 batched branch lookup | **OK**, no N+1 |
| `restaurantId` echo | each DTO item includes its own `restaurantId` | harmless (already the caller's own tenant) |

**Cross-tenant / IDOR conclusions:** `restaurantId` is **always** server-derived (`ctx.restaurantId` from the session). `entityId`, `userId`, `branchId` are all AND-ed with `restaurantId`, so a guessed foreign id yields **0 rows**, never foreign data. `getById()` repeats the same scoping (`findFirst` with `restaurantId` + optional branch `in`). The route accepts no `id` parameter at all.

---

## 6. Authorization Analysis

**Chain:** `GET /api/admin/audit-logs` → `requireAdmin(branchHintFrom(request))` → `requireRoles(["ADMIN"], requestedBranchId)` → `requireRestaurantContext()` → `requireAuth()` (NextAuth session) → DB user load (`isActive`, `sessionVersion` compare) → `UserBranch` assignments → branch-hint validation → role check.

| Role | Expected | Runtime result |
|---|---|---|
| ADMIN | allowed | `200`, 44 rows, full DTO ✅ |
| CASHIER | denied | **`403 {"message":"Access denied for your role","error":"FORBIDDEN"}`** ✅ |
| CASHIER + `x-branch-id: MAIN` | denied | **`403`** ✅ (no widening) |
| Unauthenticated | denied | **`401 {"message":"Authentication required"}`**, no data ✅ |
| Customer / public | denied | no customer/public route touches `auditLog` ✅ |

* No new RBAC is needed — the existing `requireAuth` / `requireRoles` / `requireRestaurantContext` / `authorizedBranches` set is sufficient and already wired.
* **GAP-PAGE-GUARD:** `src/middleware.ts` matcher is `["/admin/:path*", "/login"]` and only enforces **login**, not role. A logged-in CASHIER who types `/admin/audit-logs` gets **HTTP 200 page shell**, the filters render, and `auditLogService.list()` fails with 403 → the page's error state ("Coba Lagi"). Verified in the browser: **error state shown, zero rows, no leaked row id/order number**. Data is safe; only the shell is reachable. Closing it would mean a page-level role gate (see §14; optional).
* Nav hiding (`roles: ["ADMIN"]` in `layout.tsx`) is **UX only** — correctly documented in the layout as non-authoritative.
* `requireRestaurantContext` additionally rejects an inactive user and a stale `sessionVersion`.

---

## 7. Tenant / Branch Isolation

Verified live against the real DB (read-only):

| Check | Result |
|---|---|
| `auditService.list(otherTenantId, {limit:50})` | `total = 0` ✅ |
| `auditService.getById(rowOfTenantA, otherTenantId)` | `NotFoundError` ✅ |
| Admin API returns only the session tenant | all 44 items `restaurantId = cmtois12y0000bzu8o894azsd` ✅ |
| `list(restA, {}, [MAIN])` | 21 rows, **all** `branchId = MAIN` (DB MAIN count = 21) ✅ |
| branch-scoped total < restaurant total | 21 < 44 ✅ |
| `list(restA, {branchId: PERUM-1}, [MAIN])` | `ForbiddenError` ✅ |
| branch-scoped result contains **no** branch-less row | ✅ (`branchId: { in: [...] }` excludes NULL by construction) |
| Query-string `branchId` of a foreign/unknown branch | `200` with `total 0` — **no leak** (AND-ed with own `restaurantId`) ✅ |
| Row-level integrity | 0 cross-tenant `branchId`/`userId` mismatches ✅ |

**admin branch semantics (matches the request):** a **non**-branch-scoped ADMIN (`UserBranch` empty) sees *all* branches of their restaurant (`authorizedBranches` → `undefined`, no branch predicate). A **branch-scoped** ADMIN sees only assigned branches. `branchHintFrom` reads the `x-branch-id` header, validated by `requireRestaurantContext` against `UserBranch` **and** against restaurant ownership.
**CASHIER:** `authorizedBranches` is irrelevant — the role gate rejects first.

**GAP-BRANCHLESS (design gap, verified):**
The 5 live NULL-branch rows are exactly `USER_CREATED`/`USER_ACTIVATED`/`USER_BRANCH_UPDATED` writes. For a branch-scoped ADMIN, `branchId: { in: [...] }` **hides tenant-level events**. The UI gives no indication ("Tidak ada log audit untuk filter ini"), so an admin may wrongly conclude nothing happened. Two candidate fixes (choose with the product owner): (a) widen the branch-scoped predicate to `OR [branchId in filters, branchId = null]` — changes existing semantics, so it needs approval; or (b) keep isolation and label the UI ("event tanpa cabang tidak ditampilkan untuk admin ber-cabang"). **No decision taken — audit only.**

**Limitation:** the DB currently has **no branch-scoped ADMIN** (`admin@restobahagia.com`, `reksa@gmail.com` have 0 assignments) and **no second tenant with a user**, so the branch-scoped-ADMIN HTTP path and the cross-tenant HTTP path could only be exercised at the **service layer** (read-only, above). HTTP-level proof for those two cases requires temporary fixtures → deferred to §16.

---

## 8. API Gap

**`GET /api/admin/audit-logs` already exists and is adequate.** No new endpoint is required for the requested viewer.

| Existing | Detail |
|---|---|
| Method / auth | `GET`, `requireAdmin` (ADMIN-only) |
| Query params | `page`, `limit`, `action`, `entityType`, `entityId`, `userId`, `branchId`, `dateFrom`, `dateTo`, `search` |
| Response shape | `{ success, message, data: { items[], total, page, limit, totalPages } }` — **matches the requested `{items,total,page,limit,totalPages}`**, wrapped in the project's standard envelope |
| Error shape | `{ success:false, message, error }`; `400` Zod, `401` unauthenticated, `403` role/branch, `404` (service `getById` only), `500` fallback |
| Errors are Filipino-Indonesian | e.g. `"Limit maksimal 100"`, `"Halaman tidak valid"`, `"Anda tidak memiliki akses ke cabang ini"` ✅ |

**Missing (candidate gaps, none implemented):**

1. `GET /api/admin/audit-logs/[id]` — `getById()` exists but has **no transport**. Its absence forces the list to carry the full `details` payload for every row.
2. **No faceting sources**: nothing exposes the distinct `action` list or the restaurant's user list for the filter pickers, so the UI falls back to free-text.
3. **No IP data** (see GAP-IP) — an `ipAddress` column/field cannot be meaningfully populated today.
4. No **sort** parameter (fixed `createdAt desc`) — acceptable for an audit trail.
5. No **CSV/export** endpoint — not requested; noting only that sibling report routes (`/api/reports/*/export`) do have one.

---

## 9. UI Gap

`src/app/admin/audit-logs/page.tsx` (557 lines, `"use client"`) already provides: page header + "Muat Ulang", filter card, table, 6-row skeleton, empty state (with filter-aware copy + Reset), error state + retry, prev/next pagination with "`{total} log · halaman {page} dari {totalPages}`", and a detail `Dialog` containing **Waktu / Aktor / Email / Action / Entity / Entity ID / Cabang / IP / Details (pretty-printed JSON)**.

| Requested target | Existing | Gap |
|---|---|---|
| Filter date range | ✅ `Dari Tanggal` / `Sampai Tanggal` (date inputs) | — |
| Filter User | ⚠️ **raw User-ID text box** | **GAP**: needs a user picker (and the id is opaque/cuid) |
| Filter Action | ⚠️ **free-text input**, exact match | **GAP**: needs a known-actions select; `PAYMENT` → 0 rows today |
| Filter Entity Type | ✅ text input (exact) | — |
| Filter Branch | ✅ `Select` from `useBranchContext()` | — |
| Table: Date/Time | ✅ `formatTimestamp` → `17 Sep 2026, 08.30` | — |
| Table: User | ✅ actor name + role | — |
| Table: Action | ✅ | — |
| Table: Entity | ✅ entityType + mono entityId | — |
| Table: Branch | ✅ name (hidden `<lg`) | — |
| Table: **IP Address** | ❌ not a column | **GAP** (dialog-only) |
| Table: Details | ⚠️ eye icon → dialog | acceptable |
| Pagination page / size / total / next-prev | ✅ page + total + next/prev | **GAP**: no page-size selector (fixed `PAGE_SIZE = 25`) |
| Detail dialog: action/entity/entityId/actor/branch/IP/timestamp/JSON | ✅ all present | — |
| Loading / empty / error / skeleton | ✅ | — |
| Table / Button / Card / Dialog / Select / Input / Skeleton / Badge | ✅ all reuse `src/components/ui/*` | no duplicate components created ✅ |
| Admin layout + nav | ✅ reused, `roles: ["ADMIN"]` | **GAP (minor)**: entry lives under the **Settings** group, not as a top-level item between Reports/Marketing and Settings as the target sketch implies. Existing placement is discoverable and consistent — recommend **keep** |

**Notable UI details:** `useBranchContext()` is awaited before the first fetch (stale `admin_branch_id` is cleared first — mirrors customers/reservations); `branchFilter` is sent as an explicit `branchId` param; `normalizeApiError` renders API messages; the dialog helpfully states *"Data sensitif (password/token/secret) sudah disamarkan."*
The `search` box only applies on **Enter** (button-less) — minor discoverability gap.

---

## 10. Security / Privacy Findings

**Read-path redaction (implemented, verified with pure-function probes — 6/6 PASS):**

| Probe | Result |
|---|---|
| `password`, `passwordHash`, `token`, `accessToken`, `apiKey`, `api_key`, `secret`, `authorization`, `cookie`, `session` | `"[REDACTED]"` ✅ |
| Nested objects + objects inside arrays | redacted recursively ✅ |
| Safe keys (`orderNumber`, `amount`) | preserved ✅ |
| Depth > 6 | `"[TRUNCATED]"` (no unbounded recursion) ✅ |
| `email` | **NOT redacted** (deliberate) ⚠️ |

`SENSITIVE_KEY = /(pass(word|phrase)?|token|secret|api[_-]?key|credential|authorization|auth[_-]?header|cookie|session)/i` — display-time only; the stored row is untouched.

**Live data scan of all 44 rows:**
* **No password / hash / token / API key / provider credential / payment secret** was ever written. `PASSWORD_CHANGED` stores `details: {}` ✅. The `paymentTransaction.rawData`-style money payloads contain only amounts/ids ✅.
* **PII present (GAP-PII):** 2 `USER_CREATED` rows expose `{email, role, name}`; `USER_ACTIVATED`/`DEACTIVATED` expose `{email, role}`. Verified through the API: `{"email":"asep@restobahagia.com","role":"CASHIER","name":"asep"}`. This is **staff PII, ADMIN-only**, so risk is low — but it is returned in **every list row** (not just the dialog), and there is no masking or "show PII" step. Customer PII (phone/name/address) is **not** logged by any writer ✅.
* **`restaurantId`** is echoed per row — internal id, same tenant, harmless.
* **Bypass checks:** unauthenticated → `401` with no rows; CASHIER → `403` with no rows; CASHIER browser visit → error state, no row ids/order numbers in the HTML ✅. The only thing a CASHIER sees is the static page shell (and the placeholder text "mis. PAYMENT_RECEIVED" in the DOM — a hardcoded hint, not data).
* **Defensive idea (not implemented):** redaction is applied on read, so a legacy row containing a secret would still be exposed through any *future* non-`toViews` reader. Current verification shows no such row exists.

---

## 11. Performance Findings

**`EXPLAIN` (real DB, read-only):**

| Query | Plan |
|---|---|
| `WHERE restaurantId=? ORDER BY createdAt DESC LIMIT 25` | `type=index`, `key=auditlog_createdAt_idx`, `rows=25`, `Extra: Using where` |
| `… AND action=? ORDER BY createdAt DESC` | `type=ref`, `key=auditlog_action_idx`, `rows=10`, **`Extra: Using filesort`** |
| `… AND action LIKE '%PAYMENT%'` | `type=index`, `key=auditlog_createdAt_idx`, `Extra: Using where` (no index range) |

* **GAP-INDEX:** there is **no composite `[restaurantId, createdAt]`**. The list query therefore walks `auditlog_createdAt_idx` and filters with `Using where`; the action filter needs a **filesort**. Fine at 44 rows; it degrades as the table grows (an audit table only ever grows). A composite index would remove the sort — **evidence-backed, but NOT applied** (no migration this phase).
* `search` (`contains` on non-indexed `entityType`/`entityId`) is a filtered scan within the tenant.
* **Pagination = offset (`skip`/`take`)**, not keyset: deep pages get progressively more expensive, and a concurrent insert can shift rows between pages (classic offset pagination artifact). Acceptable at this scale; noted.
* **`count()` runs on every request** with the same `where` — an unavoidable second query, but it cannot be avoided while the UI needs `total`/`totalPages`.
* **No N+1:** exactly 3 queries per page (rows + count + one batched branch lookup); the actor relation uses a narrow `select`. No users/restaurant/orders are fetched wholesale; **no client-side pagination**; the browser never receives the whole table.
* Payload size is the main avoidable cost: every row carries the full `details` JSON + actor email + branch object even when the admin never opens the dialog (see GAP-DETAILS-IN-LIST). A slim list DTO + `GET …/[id]` for details would cut it.

---

## 12. Database Impact

**NONE REQUIRED. No migration, no schema change, no DDL, no DML, no seed, no relation change.**

* `AuditLog` and its 5 indexes are already migrated (`auditlog` table exists with 44 rows).
* `branch` is intentionally **not** a FK relation; resolving branch names at read time requires no schema change.
* **Optional, evidence-backed, deferred:** `@@index([restaurantId, createdAt])` (removes the filesort for the default feed) and possibly `@@index([restaurantId, action, createdAt])`. Both are *performance-only*, justified by the `EXPLAIN` in §11, and must **not** be applied without approval. At 44 rows there is currently **no measured problem**, so the default PHASE 6 decision is **NO INDEX CHANGE**.
* No data backfill is possible/needed for `ipAddress` — it is NULL historically; the gap is going forward.

---

## 13. Files To Change

### EXISTING (reuse, do not rewrite)

| File | Role in the feature |
|---|---|
| `prisma/schema.prisma` (`AuditLog`) | already correct — **do not touch** unless an index is approved |
| `src/services/audit/audit.service.ts` | `log()`, `list()`, `getById()`, `redactAuditDetails()` |
| `src/services/audit/audit.types.ts` | `AuditLogListQuerySchema` |
| `src/services/audit/audit.service.test.ts` | existing coverage — extend, don't replace |
| `src/app/api/admin/audit-logs/route.ts` | thin transport (reuse as-is) |
| `src/services/audit.service.ts` | client wrapper |
| `src/app/admin/audit-logs/page.tsx` | viewer page |
| `src/app/admin/layout.tsx` | nav entry (already there) |
| `src/lib/auth-helpers.ts` | authorization (no change) |
| `src/lib/rate-limit.ts` | `clientIp()` — the primitive to reuse for IP |
| `src/components/ui/*` | table/dialog/select/skeleton — reuse only |

### NEW FILES POSSIBLE (only if the gap fixes are approved)

| Candidate | Purpose | Necessity |
|---|---|---|
| `src/app/api/admin/audit-logs/[id]/route.ts` | expose the existing `getById()` so the list can return a slim DTO | optional (only with the slim-DTO change) |
| `src/app/api/admin/audit-logs/filters/route.ts` *(or a `distinct` mode on the list route)* | distinct `action` values (+ role-scoped user list) to feed the pickers | optional (only if the pickers are approved) |
| `src/components/admin/audit-logs/audit-log-detail-dialog.tsx`, `audit-log-table.tsx` | split the page | optional refactor; the page is 557 lines but coherent |

**Explicitly NOT to be created:** a new audit engine/model, an event bus, a second logging framework, a duplicate DB logger, new auth, new RBAC, a migration.

---

## 14. Minimal Implementation Plan

Priorities **A–J** map to the request. A–E are **already DONE**; the residual work is I‑level gap closure.

| # | Item | Status | Residual action (proposed) |
|---|---|---|---|
| A | Reuse `AuditLog` model | ✅ DONE | none |
| B | Reuse `auditService.list()` | ✅ DONE | none |
| C | Reuse existing authorization | ✅ DONE (`requireAdmin` + `authorizedBranches`) | none |
| D | Reuse existing admin UI components | ✅ DONE (`Table/Card/Dialog/Select/Skeleton/Button`) | none |
| E | Add an API only if missing | ✅ DONE (exists) | optionally add `[…/[id]]` **or** a `filters`/`distinct` source |
| F | Add the page | ✅ DONE | none |
| G | Add filters | ✅ MOSTLY DONE | **G1** Action select from known actions; **G2** Actor picker; **G3** search over `details`; **G4** `dateFrom ≤ dateTo` validation; **G5** page-size selector |
| H | Add a detail viewer | ✅ DONE (dialog) | **H1** pretty-print + a "copy JSON" affordance (optional) |
| I | Add navigation | ✅ DONE | keep under Settings (or promote to top level if the product owner prefers the sketch) |
| J | Test tenant isolation | ⚠️ PARTIAL | service-layer proven now; add HTTP-level fixtures for cross-tenant + branch-scoped ADMIN (see §16) |

### Residual work queue (proposed order, all optional/approval-gated)

1. **IP plumbing** — the only *structural* gap. Add an optional `ipAddress` to the audit input, derived from the request in the route layer via the existing `clientIp(request)` helper, and thread it to the writers (or introduce a request-scoped context). Backfill impossible → historical rows stay `—`. Touches ~15 route files → **needs explicit approval** before starting.
2. **Action/Actor filter pickers** — add a small source of distinct actions (and role-scoped users) and swap the two text inputs for `Select`/`Command` pickers; keep the `.optional()` schema untouched.
3. **`dateFrom ≤ dateTo`** — add a `.refine()` in `AuditLogListQuerySchema` (or a service check) → 400 with an Indonesian message.
4. **Extend `search` to `details`** — careful: JSON `contains` on MySQL is a full scan; only with a documented cost, or restrict to `action/entityType/entityId` and accept the gap.
5. **IP column** — add the `IP` column to the table (only meaningful after item 1). *(The "4 `branch.service.ts` writers omit `userId`" sub-item was a changed-finding: those writers already pass the actor — see the correction in §3. No actor fix is needed.)*
6. **Branch-less visibility** — decide (a) widen the predicate or (b) label it. Product decision required.
7. **Page-level role guard** — cosmetic hardening; the API already blocks data.
8. **Composite index** — only with approval + evidence of real scale.

**Do NOT:** build a second revenue-style "audit predicate", change the audit semantics of any existing writer, redesign the admin UI, or touch PHASE 5B / Print Bill / Reservation / Payment / Refund / Order engines.

---

## 15. Regression Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `redactAuditDetails` is exported from the **server** service; importing it into a client component would bundle Prisma into the browser | Low | keep server/browser trees split (`src/services/audit.service.ts` is the browser wrapper) |
| Touching `auditService.log()` signature (`ipAddress`) touches 20 call sites | Medium | make it optional with a default; writers unchanged compile fine |
| Threading IP through routes → touching ~15 `route.ts` files ≈ PHASE 5B-scale churn | **High** | do it in a separate, explicitly approved step; keep it out of the viewer-only change |
| Adding `branchId = null` OR-clause changes **existing** isolation semantics | Medium | requires product approval; the current behaviour is asserted by the existing test (`branch-less rows are excluded`) — changing it means changing a test on purpose, with justification |
| Widening `search` to JSON `details` risks slow queries | Medium | keep out, or gate behind a lower `limit` |
| Nav promotion to a top-level item could confuse users used to Settings | Low | keep current placement unless requested |
| Any change to `AuditLogListQuerySchema` can break the page's param names | Low | the page and the schema use the same names; update both together |
| PHASE 6 work must not touch the 3 already-modified files (`print-bill-dialog.tsx`, `order.service.ts`, `report.service.ts`) | Medium | scope discipline; do not rebuild `order.service.ts` |

**Confirmed non-regressions in this audit:** `tsc --noEmit` exit 0, `git diff --check` exit 0, `git status` shows **no PHASE 6 source change** (only the pre-existing PHASE 4/5B modifications), PHASE 4 Print Bill and PHASE 2/3 Reservation untouched, `/admin/audit-logs` renders for ADMIN.

---

## 16. Verification Plan

Marked `[x]` = **already executed read-only in this audit phase**; `[ ]` = to run during implementation.

| # | Check | Status | Observed / expected |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | [x] | exit 0 |
| 2 | `npm run build` | [x] | not re-run this phase — the existing `.next` build (`13:54:55`) is **newer than every `src` file** and was produced after PHASE 5B, so it served the runtime probe; re-run during implementation |
| 3 | `git diff --check` | [x] | exit 0 |
| 4 | ADMIN access | [x] | `200`, 44 rows, DTO shape exact |
| 5 | CASHIER denied | [x] | API → `403`; page → error state, 0 rows |
| 6 | Tenant isolation | [x] service / [ ] HTTP | service: other tenant → `total 0`, `getById` → NotFound. HTTP needs a temp tenant-B admin fixture |
| 7 | Branch isolation | [x] service / [ ] HTTP | `[MAIN]` → 21 rows all MAIN; foreign branch → `Forbidden`. HTTP needs a branch-scoped ADMIN fixture |
| 8 | Pagination | [x] | page 1/2 disjoint, `total` stable 44, `totalPages` 15 |
| 9 | Filters | [x] | action exact (ci), search, dateFrom/dateTo, entityType, branchId, unknown branch → 0 |
| 10 | Detail viewer | [x] | dialog opens, labels IP, renders `<pre>` JSON |
| 11 | Empty state | [x] | `search=zzz` / unknown branch → total 0 (UI renders "Belum ada/Tidak ada log"); explicit cold empty-tenant case untested |
| 12 | Malformed filter | [x] | `limit=500` → 400, `page=0` → 400, `dateFrom=2026-13-40` → 400; **`dateFrom > dateTo` → 200/0 (gap)** |
| 13 | Large page/limit | [x] | `limit=500` rejected; `limit=100` accepted (clamp works) |
| 14 | No DB mutation | [x] | counts identical before/after all reads (orders 35, payments 46, paymentTransactions 29, refunds 2, auditLogs 44, users 4, cashierShifts 7) |
| 15 | Existing audit writers still work | [ ] | propose a smoke: one cashier payment + one shift open/close + one user create/activate, asserting a new row appears with the right action/entity/actor |
| 16 | Existing service test suite | [ ] **NOT RUN** | `npx tsx --test --test-force-exit src/services/audit/audit.service.test.ts` — **not executed here because it performs fixture DML (create/delete restaurant/branch/user), which the audit-only rule forbids**; run it in the implementation phase |
| 17 | `redactAuditDetails` unit behaviour | [x] | 6/6 PASS (keys, nesting, arrays, depth cap, email passthrough) |
| 18 | `EXPLAIN` / index evidence | [x] | 3 plans captured, no composite index, filesort on the action filter |
| 19 | Regression: `/admin/reports`, Print Bill, Reservation | [ ] | not re-run this phase (files untouched; PHASE 5B already covered them) |

### Proposed fixture-based tests for the implementation phase (temporary, cleaned up in `after()`)

* **Tenant B**: create restaurant B + an ADMIN + 1 audit row → assert tenant A's admin gets `total` excluding B, and B's admin cannot see A's rows; assert `GET …/[id]` for a foreign id → 404.
* **Branch-scoped ADMIN**: create an ADMIN with a single `UserBranch` → assert only that branch's rows (and document the NULL-branch exclusion), foreign `?branchId=` → 403.
* **CASHIER**: assert `403` and 0 rows.
* Cleanup: delete fixtures in `after()`; verify `auditlog` count returns to baseline.

### Explicitly NOT RUN / limitations of this audit

* No code was changed; the "would fix it" items in §14 are **proposals**.
* `npm run build` and `tsc` were not re-run **for a code change** (there was none) — `tsc` was re-run to prove the tree is clean.
* The branch-scoped-ADMIN and cross-tenant cases were proven at the **service layer**, not over HTTP, because the DB has no second tenant with a user and no branch-scoped admin.
* The existing `audit.service.test.ts` was **not executed** (it writes fixtures).
* No production-scale performance measurement — the performance findings rest on `EXPLAIN` + code inspection at 44 rows, not a load test.
* `dateFrom > dateTo` behaviour is documented as observed, not endorsed.

---

## STOP

Audit complete. **No source modified, no migration, no schema/DB change, no dependency installed, no commit, no push, no deploy.** `HEAD` remains `d7f29ac`, port 3000 released, all temporary probe scripts removed.

**Awaiting approval before any implementation.**
