# PHASE 6B — AUDIT LOG VIEWER GAP IMPLEMENTATION REPORT

**Scope:** implement only the approved high-priority / low-risk gaps from `PHASE6-AUDIT-LOG-VIEWER-AUDIT.md`.
**HEAD (unchanged):** `d7f29ac` — **no commit, no push, no deploy.**
**Verified at:** 2026-10-08, local production build (`next start`) on port 3000 + the local MySQL dev DB.

**Result:** all 7 approved items implemented. **`tsc --noEmit` 0 · `npm run build` 0 · `git diff --check` 0 · runtime 53/53 PASS, 0 FAIL.**
**Database:** no migration, no schema change, no DDL, **no historical row touched** (44/44 legacy rows keep `ipAddress = NULL`), temporary fixtures created and removed (final `auditlog` = 44 rows, identical to the baseline).

---

## 1. Existing Functionality Reused

Nothing was rebuilt. The following existing pieces were reused as-is:

| Reused | Where | How it was used |
|---|---|---|
| `AuditLog` model + 5 indexes | `prisma/schema.prisma:522-544` | untouched (no migration) |
| `auditService.log()` | `src/services/audit/audit.service.ts` | gained request IP derivation; **signature unchanged** (only its docblock + an optional field default) |
| `auditService.list()` | same file | fits the new UI pickers unchanged; its branch logic was **extracted** into `branchPredicate()` (pure extraction — behaviour identical) |
| `auditService.getById()` | same file | untouched (still not exposed over HTTP — explicitly out of scope) |
| `redactAuditDetails()` | same file | untouched, still applied on every read |
| `GET /api/admin/audit-logs` | `src/app/api/admin/audit-logs/route.ts` | extended with an opt-in `?facets=actions` mode; the paginated list response is **byte-identical** when `facets` is absent |
| `src/services/audit.service.ts` (client) | browser wrapper | gained `listActions()`; `list()` unchanged |
| `/admin/audit-logs` page | `src/app/admin/audit-logs/page.tsx` | same layout/components; only the two filters + one column changed |
| UI components | `src/components/ui/*` | `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`Table`/`Card`/`Dialog`/`Skeleton`/`Button` — **no new component** |
| Auth helpers | `src/lib/auth-helpers.ts` | `requireAdmin`, `branchHintFrom`, `authorizedBranches`, **`requireRoles`** (now also the page guard) |
| `clientIp()` | `src/lib/rate-limit.ts:76` | the **only** IP parser used — no new IP helper |
| `userService.listUsers()` + `GET /api/users` | `src/services/shift.service.ts`, `src/app/api/users/route.ts` | Actor picker source (ADMIN-only, tenant-scoped) — **no new users endpoint** |
| `useBranchContext()` | `src/hooks/use-branch-context.ts` | unchanged branch filter |

**IP plumbing design decision (why not per-route threading):** all 20 audit writers are plain service functions called from route handlers. Threading an `ipAddress` argument would have touched ~15 route files + 6 service signatures (PHASE-5B-scale churn, high regression surface). Instead the IP is resolved from the **current request scope** that Next.js already provides (`next/headers()`, an AsyncLocalStorage-backed accessor) inside `log()`. This is **request-scoped, not process-global** — there is no mutable module state and no singleton, so no cross-request race is possible. See §4.

---

## 2. Exact Gaps Implemented

| # | Requested item | Status | What was done |
|---|---|---|---|
| 1 | IP address plumbing | ✅ implemented | `requestIpAddress()` in `auditService.log()` via existing `clientIp()`; optional, request-scoped, explicit override wins |
| 2 | Action filter → picker | ✅ implemented | `?facets=actions` on the existing endpoint + `auditLogService.listActions()` + a `Select` in the filter card |
| 3 | Actor filter → picker | ✅ implemented | reuses `GET /api/users` (`userService.listUsers()`) + a `Select`; still sends `userId` to the same audit API |
| 4 | Date validation | ✅ implemented | `.refine()` on `AuditLogListQuerySchema` → HTTP 400 with an Indonesian message |
| 5 | IP table column | ✅ implemented | responsive `IP` column (`hidden xl:table-cell`), `-` when NULL |
| 6 | Actor defect (4 writers) | ✅ **verified: no defect** | the 4 writers already pass the actor — **the PHASE 6 finding was a false positive**; the audit report was corrected instead. No code change (verified by DB + callers) |
| 7 | Page-level ADMIN guard | ✅ implemented | new server-only route segment `layout.tsx` reusing `requireRoles(["ADMIN"])` |
| 8 | Do-not-implement list | ✅ respected | none of the 11 forbidden items were implemented (see §17) |

---

## 3. Files Changed

**Modified (5):**

| File | Diffstat | Change |
|---|---|---|
| `src/services/audit/audit.service.ts` | +108 / −24 | request-IP derivation (`requestIpAddress()`), `branchPredicate()` extraction, `listActionOptions()` |
| `src/app/admin/audit-logs/page.tsx` | +114 / −21 | Action picker, Actor picker, IP column, two option-loading effects |
| `src/services/audit.service.ts` | +13 / −0 | `listActions()` client method |
| `src/app/api/admin/audit-logs/route.ts` | +17 / −0 | opt-in `?facets=actions` mode |
| `src/services/audit/audit.types.ts` | +18 / −0 | `dateFrom ≤ dateTo` refine + `AuditLogFacetsQuerySchema` |

**Added (1):** `src/app/admin/audit-logs/layout.tsx` (34 lines) — server-side ADMIN-only segment guard.

**Documentation:** `PHASE6-AUDIT-LOG-VIEWER-AUDIT.md` corrected (§3 actor row + a dated correction note, §14 item 5) — the "GAP-ACTOR" false positive.

**Total PHASE 6B code diff:** 5 files, **+239 / −31**, plus 1 new 34-line file.

**Deliberately NOT touched:** `prisma/` (schema **and** migrations), the Order / Payment / Refund / Reservation / Promo / WhatsApp engines, Print Bill, Sales Report, cashier QRIS flows, customer auth, inventory, `middleware.ts`, any RBAC/auth system.

**Incidental, reverted:** running `next build` rewrote the auto-generated `next-env.d.ts` (`.next/types` → `.next/dev/types`). It is a generator artifact ("This file should not be edited"), so it was restored with `git checkout -- next-env.d.ts`; the final diff contains no change to it.

---

## 4. IP Plumbing Design

```ts
// src/services/audit/audit.service.ts
async function requestIpAddress(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const ip = clientIp({ headers: { get: (name: string) => h.get(name) } } as unknown as Request);
    return ip === "unknown" ? null : ip;
  } catch {
    return null;
  }
}
```

* **Existing helper only:** `clientIp()` (src/lib/rate-limit.ts) — CF-Connecting-IP → first X-Forwarded-For hop → X-Real-IP → `"unknown"`. Same trusted-proxy convention the rate limiter already uses. No new IP helper, no new dependency.
* **Request-scoped, not global:** `next/headers()` is backed by Next's per-request AsyncLocalStorage. No module-level mutable variable, no singleton, no request context object that could leak between concurrent requests.
* **Dynamic import inside the try:** non-request callers (WhatsApp worker, seed/scripts/tests) neither break at import time nor throw at call time — `log()` stays fire-and-forget.
* **`"unknown"` is never stored:** the sentinel is mapped to `NULL`, so a row can never contain the bogus string `"unknown"`.
* **Explicit override wins:** `input.ipAddress ?? (await requestIpAddress())` — the signature keeps `ipAddress?: string | null` optional and unchanged, so all 20 existing callers compile and behave identically.
* **Historical data untouched:** no backfill (the 44 legacy rows are still NULL).
* **No widening to public/customer flows:** traced every audited write to its route — all 20 are reachable only from ADMIN/CASHIER endpoints (`/api/admin/branches/*`, `/api/users/*`, `/api/shifts/*`, `/api/refunds/*`, `/api/cancellations/*`, `/api/menu/products`, `/api/payments/[id]/mark-paid`). The public/customer routes (`/api/public/*`) that use `paymentService.createPayment` never reach an audit write (the single `PAYMENT_RECEIVED` write lives in `markCashierPaymentPaid`, called only by the cashier route). Nothing new is collected anywhere.
* **No secrets:** only the IP string is stored; no payment secret / provider credential is read or logged.

---

## 5. Action Filter Design

* **Source = the database, never a literal** (a hardcoded list would go stale the moment a new action ships):
  ```ts
  async listActionOptions(restaurantId, raw, branchFilters) {
    const parsed = AuditLogFacetsQuerySchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.message);
    const rows = await prisma.auditLog.findMany({
      where: { restaurantId, ...this.branchPredicate(parsed.data.branchId, branchFilters) },
      distinct: ["action"], select: { action: true }, orderBy: { action: "asc" }, take: 200,
    });
    return rows.map((r) => r.action);
  }
  ```
* **Reuses the existing endpoint** — no new route: `GET /api/admin/audit-logs?facets=actions` → `{ success, data: { actions: string[] } }`. Absent `facets`, the paginated list response is unchanged.
* **Tenant + branch scoped, no widening:** `restaurantId` comes from the session only; the branch predicate is the **same helper** `branchPredicate()` used by `list()`, so an explicit `branchId` outside a branch-scoped admin's assignments → **403**, and a branch-scoped admin without one is limited to `branchId: { in: authorizedBranches }`. Because the predicate is shared, the picker and the table can never drift.
* **UI:** the free-text `Input` was replaced by the existing `Select` (shadcn/Radix), options = "Semua Action" + the scoped distinct actions. The selected value is still sent as the same `action` query param to the same endpoint.
* **Read-only + capped:** `take: 200` so a pathological tenant cannot return an unbounded list.
* Verified live: tenant actions = DB actions (11/11); branch-scoped MAIN = DB MAIN actions (8/8); CASHIER → 403; `facets=bogus` → 400 `"Parameter facets tidak valid"`.

---

## 6. Actor Filter Design

* **Source = the existing users data source**, exactly as the audit recommended: the page reuses the already-existing client `userService.listUsers()` (`src/services/shift.service.ts`) → `GET /api/users`, which is `requireAdmin()` + `userService.listUsers(restaurantId)`.
* **Tenant-safe:** the API derives `restaurantId` from the session; the response contains only that restaurant's staff. Verified: 4 API users = 4 DB users for the tenant; 0 users belong to any foreign tenant.
* **No customer picker, no new endpoint.**
* **UI:** the opaque raw `User ID` text box was replaced by the existing `Select`; options = "Semua Aktor" + `name (ROLE)` per staff user. The selected value is still sent as `userId` to the **same** audit API.
* Picker failures are non-fatal (swallowed) — the viewer still lists and filters without the dropdown.

---

## 7. Date Validation

* Added to `AuditLogListQuerySchema` (`src/services/audit/audit.types.ts`):
  ```ts
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    message: "Tanggal awal tidak boleh melebihi tanggal akhir",
    path: ["dateTo"],
  })
  ```
* Both bounds are strict `YYYY-MM-DD` (`isValidDateOnly`), so the lexicographic comparison is also chronological.
* Result: `dateFrom > dateTo` → `ValidationError` → **HTTP 400**, message **"Tanggal awal tidak boleh melebihi tanggal akhir"** (carried in the project's standard Zod issue payload).
* `dateFrom === dateTo` remains valid; a single day still works.
* **Timezone semantics untouched:** the local-day bounds in `list()` (`T00:00:00.000` / `T23:59:59.999`) were not modified.

---

## 8. Actor Fixes

**No code change was required — and none was made.** The audit's "GAP-ACTOR" was a **false positive** in the PHASE 6 report:

* All 4 writer blocks (`branch.service.ts:128`, `:169`, `:209`, `:503`) DO pass the actor using the **shorthand property** `userId,`. The audit's extraction regex only matched `userId:` (with a colon), so it reported an empty actor.
* Confirmed by the live DB: **0 of 44 rows have `userId = NULL`** — including every `BRANCH_*` action (`BRANCH_CREATED`, `BRANCH_ACTIVATED`, `BRANCH_DEACTIVATED`, `BRANCH_PRODUCT_UPDATED` all show 0 NULLs).
* Confirmed the actor is **server-derived, never client-supplied**: the callers pass `ctx.userId` from `requireAdmin()` (`branch.service.ts` callers in `/api/admin/branches/[id]/route.ts` and `.../[id]/status/route.ts`).
* A **new** branch audit event was produced through the real flow (PUT `/api/admin/branches/[id]`) and its `userId` equals the authenticated admin's id (`cmtois1bh0001bzu8z544lejp`) — runtime check 12.
* The PHASE 6 audit document was corrected (that section + §14 item 5) with a dated note, so the declared source of truth no longer contains the wrong finding.

---

## 9. Page Authorization

* New **server component** route segment: `src/app/admin/audit-logs/layout.tsx`
  ```tsx
  let allowed = true;
  try { await requireRoles(["ADMIN"]); } catch { allowed = false; }
  if (!allowed) redirect("/admin/dashboard");
  return <>{children}</>;
  ```
* Reuses the **existing** `requireRoles` helper (which also re-validates the DB user, `isActive`, `sessionVersion`, and branch access) — **no new auth, no new RBAC**.
* `redirect()` is called **outside** the try/catch so its thrown `NEXT_REDIRECT` signal is not swallowed.
* **`middleware.ts` was not modified** — the global admin middleware still only checks authentication, so no other ADMIN/CASHIER page is affected.
* Result: a CASHIER typing `/admin/audit-logs` is redirected to `/admin/dashboard` and **never receives the page shell** (runtime check 13: `shellRendered=false`). ADMIN still gets the page (check 13b: HTTP 200 + "Riwayat Audit").
* Defence in depth: the API remained ADMIN-only independently (checks 2, 5e, 6d, 7c all 403).

---

## 10. Database Impact

* **Migration: NONE. Schema change: NONE. DDL: NONE. Seed: NONE. Index change: NONE.**
* `prisma/` (schema + migrations) is byte-identical to `HEAD`.
* **No historical row modified:** all 44 legacy rows still have `ipAddress = NULL` (verified before and after: `nullIp = 44 of 44`).
* **Only intentional temporary writes:** 3 audit rows created during verification (2 `BRANCH_UPDATED` from the real service flow, 1 `P6B_SCRIPT_PROBE` for the out-of-request path). All 3 were deleted; final state is identical to the baseline.

  | Table | Before | After |
  |---|---|---|
  | order / payment / paymentTransaction / refund | 35 / 46 / 29 / 2 | 35 / 46 / 29 / 2 |
  | auditLog | 44 | **44** (0 `BRANCH_UPDATED`, 0 `P6B_SCRIPT_PROBE` leftover) |
  | user / cashierShift / branch / product | 4 / 7 / 2 / 8 | 4 / 7 / 2 / 8 |
  | customer / reservation / promo | 35 / 1 / 2 | 35 / 1 / 2 |
* The `branch` row used for the IP/actor fixture was asserted unchanged (name/address/phone/code identical) — the audit event came from a real request, not a data mutation.
* The composite `[restaurantId, createdAt]` index from the audit was **not** added (explicitly out of scope).

---

## 11. Security Impact

| Requirement | Status | Evidence |
|---|---|---|
| ADMIN only | ✅ unchanged | list/facets 200 for ADMIN; **403 for CASHIER** (checks 2, 6d) |
| Tenant scoped | ✅ | `restaurantId` from `ctx` only; foreign tenant → 0 rows; no foreign id in any response |
| Branch scoped | ✅ | explicit `branchId` within scope only; foreign branch → 403 (both `list` and `facets`); branch-less rows still excluded as before |
| Action picker tenant/branch scoped | ✅ | shared `branchPredicate()`; MAIN facet set = DB MAIN set (8/8) |
| Actor picker tenant scoped | ✅ | `GET /api/users` = `requireAdmin` + session `restaurantId`; 4/4 own users, 0 foreign |
| IP server-derived | ✅ | derived from the request; only an explicit internal override can change it; no client input path |
| Client `restaurantId` never trusted | ✅ | the route never reads a restaurant id from query/body |
| Client actor identity never trusted | ✅ | `userId` param is a **filter**, not an identity; the recorded actor is `ctx.userId` (check 12) |
| No password/hash/token/apiKey/secret/payment credential exposed | ✅ | no writer stores them; `redactAuditDetails()` still applied on every read; no writer was changed |
| `redactAuditDetails()` remains active | ✅ | untouched; applied inside `toViews()` before the DTO leaves the service |
| Authorization not weakened | ✅ | list/route/page guards all still ADMIN-only; nothing was relaxed |

**Known limitation (documented, not introduced):** the IP is taken from proxy headers per the project's existing `clientIp()` convention, so it is only as trustworthy as the reverse proxy in front of the app (the same assumption the rate limiter already makes). Behaviour behind no proxy: Next supplies its own forwarded header, so a real socket address (e.g. `::1` locally) is recorded rather than `"unknown"`.

---

## 12. Runtime Verification

Harness: real production build (`next start`, port 3000), real NextAuth form logins in headless Chrome for ADMIN (`admin@restobahagia.com`) and CASHIER (`kasir@restobahagia.com`), real HTTP calls with session cookies, and independent DB recomputation for every expectation.

**RESULT: 53/53 PASS, 0 FAIL.**

| # | Required runtime test | Result |
|---|---|---|
| 1 | ADMIN `GET /api/admin/audit-logs` → 200 | ✅ 200; total 44 = DB 44; response keys still `items,total,page,limit,totalPages` |
| 2 | CASHIER → 403 | ✅ 403 (`Access denied for your role`) |
| 3 | Unauthenticated → 401 | ✅ 401 |
| 4 | Tenant isolation: foreign tenant never appears | ✅ 0 foreign rows in the response; service-scoped foreign tenant → 0 |
| 5 | Branch isolation: assigned branch only | ✅ `?branchId=MAIN` → 21/21 MAIN; `?branchId=PERUM-1` → 18/18; `authorizedBranches` list → 21/21 MAIN, foreign branch → Forbidden; CASHIER with a branch header still 403 |
| 6 | Action filter: select PAYMENT_RECEIVED → only those rows | ✅ API 10/10 exactly `PAYMENT_RECEIVED`; **UI picker**: table went 25 → **10** rows and the table body contains no other action |
| 7 | Actor filter: select a valid actor → only that actor's rows | ✅ API 21/21 for that actor; **UI picker**: table 24 rows, other actor's name absent |
| 8 | Date: valid range → correct results | ✅ single day 12 = DB 12; wide range 44 = DB 44 |
| 9 | Invalid date: `dateFrom > dateTo` → 400 | ✅ 400, message **"Tanggal awal tidak boleh melebihi tanggal akhir"**; equal dates still 200 |
| 10 | IP: new audited action via the existing flow records the IP | ✅ `PUT /api/admin/branches/[id]` with `X-Forwarded-For: 203.0.113.7` → new row `ipAddress = "203.0.113.7"`; without an explicit header → `"::1"` (Next's own forwarded header), never the `"unknown"` sentinel |
| 11 | Historical rows keep `ipAddress = NULL` | ✅ 44/44 NULL |
| 12 | New branch audit event has the correct actor | ✅ `userId` = the authenticated admin's id; `entityType=Branch`, `branchId` correct |
| 13 | CASHIER browser cannot render the page shell | ✅ redirected to `/admin/dashboard`; `Riwayat Audit`/`Detail Log Audit` absent |
| 14 | No DB mutation except the temporary fixture/event | ✅ full 12-table snapshot identical before/after |
| 15 | Temporary fixture/event cleaned up | ✅ 3 audit rows deleted; `auditlog` back to 44 |
| 16 | Print Bill unchanged | ✅ no file touched (`print-bill-dialog.tsx` mtime 13:35, before PHASE 6B); `/admin/orders` (its host page) still 200 |
| 17 | Reports unchanged | ✅ no report file touched; `GET /api/reports/sales?period=today` 200 and **dashboard.todayRevenue === report.summary.totalSales** (PHASE 5B intact) |
| 18 | Reservation unchanged | ✅ no reservation file touched; `/reservasi` still 200 |
| 19 | `git status --short` | ✅ see §19 |

**Extra checks beyond the list:** out-of-request `log()` does not throw and stores NULL (worker/script safety); `facets` mode honours branch scope and rejects an unknown value with 400; `Reset Filter` restores the unfiltered list; the detail dialog still opens with the redacted JSON; 3 filter-card Selects + the shell's branch Select all render as existing components.

**Tests that failed at some point and how they were resolved — all were harness defects, none an app defect:**

1. *1st run:* `6c. facets honour branch scope` FAILED — a **real implementation gap I had introduced** (the facets route ignored the `branchId` param while the page sent it). Fixed properly by extracting the shared `branchPredicate()` and passing `params` through, then re-verified green. This is the one genuine defect found and fixed by the verification.
2. *1st run:* `10e` FAILED on the assumption that no proxy header ⇒ NULL. Reality: Next supplies its own `x-forwarded-*`, so a real address (`::1`) is recorded — i.e. the feature works *better* than the assertion assumed. The assertion was corrected to what the requirement actually asks (a request-derived IP, never the `"unknown"` sentinel) and the no-IP path is covered separately by the out-of-request check.
3. *2nd/3rd run:* picker checks FAILED because the harness addressed the page's Selects by positional index while the admin shell also renders a branch Select (4 comboboxes total), and because a Select's option list legitimately contains every action name. The harness was changed to address the Selects by their label text and to assert against the **table body** only.

---

## 13. `tsc` Result

```
$ npx tsc --noEmit
(no output) — exit code 0
```
Run on the final source revision (after all edits) **and** again after restoring the generated `next-env.d.ts`: **exit 0 both times**. No suppressions, no `any` added to silence anything.

## 14. Build Result

```
$ npm run build
✓ Compiled successfully in 8.2s
  Finished TypeScript in 16.6s
✓ Generating static pages (124/124)
(exit code 0)
```
6 warnings, **all pre-existing and unrelated** to this work: 2 "overly broad file pattern" warnings in the upload services, 2 import traces of those, and the Next 16 `middleware`→`proxy` deprecation notice. No warning references any PHASE 6B file.

## 15. Diff-Check Result

```
$ git diff --check
(no output) — exit code 0
```
No whitespace errors, no conflict markers.

---

## 16. Regression Verification

| Area | Method | Result |
|---|---|---|
| Print Bill (PHASE 4) | file untouched (mtime before PHASE 6B; not in `git status` changeset beyond its pre-existing PHASE 4 diff) + host page 200 | ✅ unchanged |
| Sales Report semantics (PHASE 5B) | no report file touched; runtime equality `dashboard.todayRevenue === report.summary.totalSales` holds | ✅ unchanged |
| Reservation (PHASE 2/3) | no reservation file touched; `/reservasi` 200 | ✅ unchanged |
| Payment / QRIS / cashier payment engine | no payment file touched; the audited write path is unchanged in behaviour (same row, same fields, `+ipAddress`) | ✅ unchanged |
| Order engine | no order file touched (`order.service.ts` only carries its pre-existing PHASE 5B diff, mtime 13:52) | ✅ unchanged |
| Promo / customer auth / WhatsApp / inventory | not touched; middleware unchanged | ✅ unchanged |
| Audit-log API contract | response shape identical when `facets` is absent; the 9 existing filters behave as before | ✅ unchanged |
| Existing audit writers | no writer signature change; all 20 call sites compile; a real flow (PUT branch) still produces a correct row | ✅ verified |
| DB integrity | 12-table snapshot before/after identical | ✅ |
| PHASE 6 audit doc | `GAP-ACTOR` correction applied; no other finding changed | ✅ |

---

## 17. Remaining Gaps Intentionally NOT Implemented

All 11 forbidden items were left alone, as instructed:

1. **Branch-less event semantic change / widening `branchId = NULL` visibility** — needs a product decision (today `USER_*` tenant-level events remain hidden from a branch-scoped admin); the PHASE 6 audit documented both candidate options.
2. **JSON `details` search** — would add a non-indexed `LIKE` scan over JSON; needs a scale decision.
3. **Composite database index** (`[restaurantId, createdAt]`) — evidence exists (`EXPLAIN` filesort) but at 44 rows there is no measured problem; requires approval.
4. **Keyset/cursor pagination** — offset pagination retained.
5. **CSV export** — not requested.
6. **`GET /api/admin/audit-logs/[id]`** — the detail dialog still reads from the list row, so the full `details` payload still ships with every row.
7. **Page redesign** — layout preserved; only the two filters and one column changed.
8. **New audit engine / new model / migration** — none.
9. **RBAC system / new authentication** — reused the existing helpers only.
10. **Notification system** — none.
11. *Implicitly out of scope but still open from the audit:* the `search` box is still Enter-to-apply, there is no page-size selector, and PII (staff email/role/name in `USER_*` details) is still returned unmasked to ADMIN.

Also still open (unchanged from the audit): the page is 640+ lines and could be split, and `getById()` remains unused by the API.

---

## 18. Risks

| Risk | Assessment | Mitigation in place |
|---|---|---|
| IP derived from proxy headers can be spoofed if the app is not behind a trusted proxy | Medium (pre-existing project convention, same as the rate limiter) | documented as a limitation; only the request-derived value is stored; no client input path |
| `next/headers()` in `log()` adds a small per-write cost | Low | dynamic import + synchronous header read; measured impact is negligible vs. the DB write |
| `log()` now depends on Next's request scope | Low | fully wrapped in try/catch; verified that an out-of-request call neither throws nor stores a bogus value |
| The facets mode is a mode-switch on one endpoint | Low | opt-in only, 400 on an unknown value, and the default response is unchanged; covered by runtime tests |
| Action picker options come from existing rows, so a brand-new action is only selectable after it has been written once | Low / by design | a new free-text UI was rejected on purpose to avoid a stale hardcoded list; admin can still use `search` |
| Actor picker lists all staff users, including those with no audit rows | Low (UX) | harmless: selecting such a user yields an empty result with the existing empty state |
| Branch-scoped ADMIN HTTP path not exercised in this phase | Medium (coverage) | the DB has no branch-scoped admin and creating one would exceed the allowed fixtures; verified via `authorizedBranches` at the service layer + explicit `?branchId=` HTTP checks + CASHIER 403 |
| PII in `details` still visible to ADMIN | Low (ADMIN-only) | unchanged from the audit; `redactAuditDetails()` still active; deliberately not changed (would be a semantics change) |

---

## 19. `git status --short`

```
 M src/app/admin/audit-logs/page.tsx
 M src/app/api/admin/audit-logs/route.ts
 M src/services/audit.service.ts
 M src/services/audit/audit.service.ts
 M src/services/audit/audit.types.ts
?? src/app/admin/audit-logs/layout.tsx
 M src/components/admin/orders/print-bill-dialog.tsx     ← pre-existing PHASE 4 diff (not touched in 6B)
 M src/services/order/order.service.ts                   ← pre-existing PHASE 5B diff (not touched in 6B)
 M src/services/report/report.service.ts                 ← pre-existing PHASE 5B diff (not touched in 6B)
?? PHASE6-AUDIT-LOG-VIEWER-AUDIT.md                       ← PHASE 6 audit (corrected in 6B)
?? PHASE6B-AUDIT-LOG-VIEWER-IMPLEMENTATION-REPORT.md      ← this report
?? AUDIT-PRINT-BILL.md, PHASE1.5-…, PHASE2-…, PHASE3-…, PHASE4-…, PHASE5-…   ← earlier phases' reports
```

The 5 modified audit files + 1 new layout are the complete PHASE 6B changeset. The other three modified files carry only their pre-existing PHASE 4/5B diffs (verified: their mtimes are 13:35/13:52, before PHASE 6B began, and no PHASE 6B tool call touched them). `next-env.d.ts` was restored. No temporary harness file remains. Port 3000 is free.

## 20. Commit / Push / Deploy Status

**NONE.**
* No commit — `HEAD` is still `d7f29ac`.
* No push to any remote.
* No deploy; nothing outside the local working tree and the local dev DB was touched. No production/VPS access, no DB reset, no migration reset.

All changes are staged in the working tree only, awaiting review.

---

**STOP.** Implementation + verification complete; report delivered. No commit, no push, no deploy.
