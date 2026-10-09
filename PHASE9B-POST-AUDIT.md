# PHASE 9B — POST-IMPLEMENTATION AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac`
**Audit type:** strict post-implementation audit (no feature work, no PHASE 10)
**Date:** 2026-10-08

---

## 1. Executive Summary

PHASE 9B **satisfies its documented requirements**. All 12 implemented findings (C1–C6, C8–C13)
behave as specified; the canonical revenue engine is reused (not replaced); customer password
redaction holds on the customer endpoints; tenant/branch scoping, CSV escaping, date validation and
auth are correct; and the database is unchanged.

The audit found **no defect introduced by PHASE 9B that breaks its own requirements**, but it did
surface **pre-existing and consistency issues outside the 9B change-set**:

| ID | Severity | Summary | Status |
|---|---|---|---|
| F1 | **HIGH** | `GET /api/orders` (and other non-report endpoints) serialize the customer **bcrypt `password` hash** + `whatsappId`. Pre-existing; **not a PHASE 9B file**, out of C1's scope. | Open — documented, not fixed |
| F4 | MEDIUM | The canonical revenue predicate is duplicated in 4 new 9B raw queries (divergence risk; numerically equal today). | Open — documented |
| F2 | LOW | Reservation CSV export revenue disagrees with the report when a reservation's `orderId` points at an order in another branch. | Open — documented |
| F3 | LOW | Customer report includes customers created in the period even when their activity is in another branch (branch-scope widening vs the operational list). | Documented design |
| F5–F8 | INFO | Documented semantics (list `orderCount` basis, no-show snapshot, revenue date basis, cross-tenant not runtime-testable). | Documented |

**No fix was applied.** Per the audit rule, fixes are limited to defects "clearly required to make
the PHASE 9B implementation correct and small and safe". F1 touches the Order/Payment engines
(9B PART 19 forbids) and is outside C1's scope; F2/F3/F4 are correctness-preserving/refactor issues.

**Verification:** `npx tsc --noEmit` → 0 errors; `npm run build` → exit 0; `git diff --check` →
clean; existing pure tests 27 pass; runtime harness → **ALL PASS** (canonical-equality for 4 cases,
refund edges, empty states); DB counts restored; no schema/migration change; `HEAD = d7f29ac`.

---

## 2. Scope

In scope: the PHASE 9B change-set (C1–C6, C8–C13), the canonical revenue rule it consumes, the 4 new
API routes, the 2 new UI pages, the navigation entry, and the post-audit integrity of the database.

Out of scope (reported but not modified): unrelated pre-existing defects (F1), and any PHASE 10 work.

---

## 3. Source of Truth

- `PHASE9-CUSTOMER-RESERVATION-REPORT-AUDIT.md` (findings C1–C15)
- `PHASE9B-CUSTOMER-RESERVATION-REPORT-IMPLEMENTATION.md` (implementation claims)
- `PHASE8-FINANCE-CONSISTENCY-AUDIT.md` + `PHASE8B-FINANCE-CONSISTENCY-HARDENING-REPORT.md` (canonical revenue)
- Code under audit: `src/services/report/report.service.ts`, `src/services/customer/customer.service.ts`,
  `src/app/api/customers/**`, `src/app/api/reports/{customers,reservations}/**`.

---

## 4. Customer Security Audit

| Check | Result | Evidence |
|---|---|---|
| `password` not in `GET /api/customers` | ✅ PASS | keys = `id,name,phone,email,isActive,createdAt,updatedAt,orderCount,totalSpent,lastOrderAt`; `password` absent |
| `whatsappId` not in `GET /api/customers` | ✅ PASS | `whatsappId` absent |
| `password`/`whatsappId` not in `GET /api/customers/[id]` | ✅ PASS | detail keys exclude both |
| `password`/`whatsappId` not in `POST /api/customers` / `PUT` | ✅ PASS | `findOrCreateCustomer`/`updateCustomer` use `CUSTOMER_PUBLIC_SELECT` |
| Customer CSV has no sensitive fields | ✅ PASS | `grep -c password` = 0 |
| Customer endpoints restaurant-scoped | ✅ PASS | session `restaurantId` |
| Branch-scoped user cannot read another branch's customer orders | ✅ PASS | `getCustomer(id, rid, [OTHER])` → 0 orders for a MAIN-only customer |
| **Other endpoints** do not leak the hash | ❌ **FAIL (F1)** | `GET /api/orders?limit=100` → 3 orders with `customer.password = $2b$12$…` (60 chars) |

`order.service.ts` `customer: true` sites: lines **125 (type), 507, 1253, 1370, 1431, 1493, 1612,
1688**; `payment.service.ts`: lines **55, 1275**. See §18 F1.

---

## 5. Customer Revenue Audit

- `totalSpent` (list) = `computeCustomerRevenue(...).netSales` — refund-aware canonical net. ✅
- `getCustomerReport` summary vs canonical Sales Report (same scope) — **exact match**:
  `totalSales 517000`, `grossSales 517000`, `totalOrders 16`, `items 0`, `totalRefund 30000`,
  `netSales 487000`, `AOV 32312.5`. ✅
- `computeCustomerRevenue.total.netSales` == `computeRefundRevenue.total.netSales` (487000). ✅
- CANCELLED excluded; UNPAID excluded; FAILED/EXPIRED excluded (revenue predicate
  `status <> 'CANCELLED' AND (paymentStatus='PAID' OR EXISTS payment REFUNDED)`). ✅
- APPROVED refunds deducted via the canonical `LEAST(refunded/grandTotal,1)` product-basis rule. ✅
- Tax/service-charge treatment identical to canonical (`grandTotal − tax − serviceCharge`). ✅
- **No second *authoritative* formula**: `computeCustomerRevenue` is a GROUP-BY-customer copy of the
  canonical math, not an independent definition (risk noted as F4).
- **Canonical engine unmodified.** ✅

---

## 6. Customer Report Audit

| Area | Result | Notes |
|---|---|---|
| Date filtering | ✅ | `resolveReportRange` (today/yesterday/week/month/custom) |
| Branch filtering | ⚠ LOW F3 | order/branch metrics are scoped; customer *identity* list is not branch-filtered (restaurant-global) |
| Tenant filtering | ✅ | session `restaurantId` |
| Classification | ✅ | new = created in period; returning = activity in period AND first order < range.start; active = ≥1 order in period; inactive = prior history only |
| Order counts | ✅ | revenue-set count |
| Reservation counts | ✅ | by `reservationDate` |
| AOV | ✅ | `totalSales / totalOrders` (canonical basis), guarded → 0 when no orders |
| Gross sales / total sales | ✅ | Σ subtotal / Σ grandTotal over revenue set |
| Refund / net sales | ✅ | canonical |
| First/last order | ✅ | all-time first; period last |
| Wrong boundaries / TZ | ⚠ INFO | order date bounds use local-midnight `Date` (pre-existing convention, identical to Sales Report); reservation dates use UTC-midnight (correct for `@db.Date`) |
| Empty state | ✅ | all-zero, no NaN |
| No customers | ✅ | `[]` + zero summary |

---

## 7. Reservation Report Audit

| Area | Result | Notes |
|---|---|---|
| `reservationDate` filtering | ✅ | `resolveReservationDateRange` re-anchors local day → UTC midnight (matches `dbDateFromDateOnly`) |
| Branch filtering | ✅ | `branchId IN (...)` on reservations and on revenue |
| Tenant isolation | ✅ | `restaurantId` predicates |
| Status breakdown | ✅ | `groupBy(status)` |
| Party size | ✅ | `totalGuests`, `avg = guests/total`; `byPartySize.guests = partySize × count` |
| Table breakdown | ✅ | `groupBy(tableId)` + table name lookup |
| Source breakdown | ✅ | `groupBy(source)` |
| Daily breakdown | ✅ | `DATE_FORMAT(reservationDate,'%Y-%m-%d')` |
| Payment classification | ✅ | `Order.paymentStatus` groupBy + `NO_ORDER` |
| Cancellation rate / no-show rate | ✅ | `cancelled/total`, `noShow/total`, guarded |
| Funnel | ✅ | Created→Confirmed→Paid→Seated→Completed (+ Cancelled/No-show) |
| `reservationDate` vs `createdAt` vs `order.createdAt` vs `refund.approvedAt` **not mixed** | ✅ | report scope = `reservationDate`; revenue = order/refund dates (documented, F7); `createdAt` exported separately |

---

## 8. Reservation Revenue Audit (HIGH-PRIORITY)

**Chain verified:** `Reservation → orderId → canonical computeRefundRevenue → product → refund → net`.

Runtime (fixtures in A, canonical-equality assertions):

| Case | Result |
|---|---|
| 3 reservations → same order (duplicate links) | ✅ report == canonical (order set is a SQL `IN` set ⇒ never double-counted) |
| Unpaid reservation (order not on revenue set) | ✅ product revenue **0** |
| Fully refunded order | ✅ `product 30000, refund 30000, net 0` |
| Paid order (no refund) | ✅ positive revenue (60000 incl. refund-order product) |
| Cancelled-order link (HIST, CANCELLED+PAID) | ✅ excluded by `status <> 'CANCELLED'` (audit-#17) |
| Partially refunded order | ⚠ **not runtime-testable** — DB has only one APPROVED refund and it is a full refund |
| Paid reservation | ✅ |
| Reservation without order | ✅ no revenue |
| Cross-**tenant** `orderId` | ✅ prevented structurally (`o.restaurantId`); not runtime-testable because restaurant B has no branch (F8) |
| Cross-**branch** `orderId` | ⚠ LOW **F2** — report excludes the other-branch order, the CSV export includes it |

The report's `reservationRevenue/refund/net` equal `computeRefundRevenue` with the same order-id
filter for every tested range. **A reservation cannot book another restaurant's order** (tenant
predicate in both the canonical SQL and the `groupBy`/`findMany`).

---

## 9. CSV Export Audit

| Check | customers/export | reservations/export |
|---|---|---|
| ADMIN authorization | ✅ 403 for CASHIER, 401 unauth | ✅ |
| Tenant isolation | ✅ session scope | ✅ |
| Branch authorization | ✅ validated `branchId` param | ✅ |
| Date validation | ✅ `period=custom` without dates → 400; start>end → 400 | ✅ |
| CSV escaping | ✅ `buildCsv` RFC-4180 | ✅ |
| Formula-injection protection | ✅ temp name `=1+1,"x"` → `"'=1+1,""x"""` | ✅ (same helper) |
| No passwords/secrets | ✅ `password` absent | ✅ |
| No internal IDs | ✅ business fields only (`Kode`, names) | ✅ |
| Exported revenue matches API/UI | ✅ (except the F2 cross-branch edge) | ⚠ F2 |

---

## 10. Tenant Isolation

- Endpoints: session `restaurantId` only; a branch id from another restaurant → **403 "Cabang tidak
  ditemukan"**.
- Service: reports for restaurant B → 0 rows / 0 revenue.
- Reservation revenue: `o.restaurantId = ?` in product **and** refund halves; classification and
  export order lookups also carry `restaurantId`.
- **No cross-tenant read path found.**

---

## 11. Branch Isolation

- Explicit validated `branchId` param, else `authorizedBranches(ctx)` (for scoped users).
- Customer report: `?branchId=OTHER` → 11 orders / 367000; MAIN → 150000; **sum = 517000** (reconciles).
- Reservation report: OTHER 0, MAIN 1.
- Customer detail: `[OTHER]` → 0 orders for a MAIN-only customer.
- ⚠ F3: the customer-report *customer list* is not branch-filtered (restaurant-global identity).
- Note: for an **unscoped** admin the `x-branch-id` header is a hint only — pre-existing, shared
  with the sales report.

---

## 12. Performance Audit

No N+1 found. All aggregation is server-side and batched:

| Operation | Queries |
|---|---|
| `getCustomers` (list) | 2 (rows + canonical revenue) + 1 count |
| `getCustomerReport` | customers + 4 batched raw/aggregate + 1 reservation-order lookup |
| `getReservationReport` | 6 `groupBy/aggregate` + 2 raw + 2 name lookups; orderIds collected once |
| `getReservationsForExport` | 1 reservations + 5 batched lookups |

- Branch/table/customer/order name resolution is batched via `IN (...)` maps.
- No full order/customer/reservation set is streamed to the browser for client-side math.
- **No speculative index added.** The reservation-revenue query uses the `Order` PK (`o.id IN`) and
  the existing reservation composite index; **no migration recommended** (see §21).

---

## 13. Regression Audit

| Component | Changed by 9B? | Evidence |
|---|---|---|
| Sales Report | No (verified numbers unchanged) | 517000/487000/16/0/30000/32312.5 |
| Payment Report | No | file untouched by 9B |
| Profitability Report | No | untouched |
| Reservation purchase/payment flow | No | `reservation/*` untouched |
| Payment flow | No | `payment.service.ts` untouched by 9B |
| Refund flow | No | untouched |
| Customer authentication | No | `customer-auth/*` untouched |
| WhatsApp | No | untouched |
| Inventory | No | untouched |
| Print Bill | No | untouched |
| Multi Outlet | No | untouched |
| Existing admin customer page | Compatible | reads `name/phone/orderCount/totalSpent/lastOrderAt` — all present |
| Existing admin reservation page | No | untouched |

`order.service.ts` shows as modified in the working tree — that is **pre-existing PHASE 7B**, not 9B.

---

## 14. Database Integrity

- `git status` → no `prisma/` changes; no new migration directory; `migration_lock.toml` unchanged.
- `git diff --check` → clean.
- No historical row modified; the only writes were temporary fixtures (prefix `P9BAUD-` / `p9baud-`).
- Temporary files removed (`ls _p9b*` → none).
- Harness before/after: `{orders 35, customers 35, reservations 1}` → identical; inject fixture
  cleaned (`cleaned 1`).
- `HEAD = d7f29ac`. Nothing committed/pushed/deployed.

---

## 15. TypeScript Verification

`npx tsc --noEmit` → **0 errors**.

---

## 16. Build Verification

`npm run build` → **exit 0**; the 6 new routes/pages compile:
`/admin/reports/customers`, `/admin/reports/reservations`, and the 4 `/api/reports/...` handlers.

---

## 17. Runtime Verification

- **HTTP (server `next start`):** 4 endpoints unauth → 401; CASHIER → 403; `period=custom` missing
  dates → 400; `start>end` → 400; exports 200 with correct headers; formula-injection guard
  verified; no `password` in customer CSV.
- **Fixture harness (tsx):** ALL PASS — canonical-equality for REFUND/UNPAID/PAID/XBRANCH ranges,
  unpaid→0, fully-refunded net 0, paid positive, empty-state zeros, customer-net == canonical, DB
  restore.
- **Findings logged:** F1 (`/api/orders` bcrypt leak), F2 (cross-branch export≠report).

---

## 18. Findings

### F1 — Customer bcrypt password + `whatsappId` leaked by order/payment endpoints
- **Severity:** HIGH
- **Status:** Confirmed / Open — **pre-existing, not introduced or fixed by PHASE 9B** (outside C1's customer-endpoint scope)
- **Exact file:** `src/services/order/order.service.ts` (125, 507, 1253, 1370, 1431, 1493, 1612, 1688), `src/services/payment/payment.service.ts` (55, 1275)
- **Exact function:** `OrderService.getOrders` and the other `include: { customer: true }` read paths; `PaymentService` reads
- **Evidence:** `GET /api/orders?limit=100` returns 3 orders whose `customer.password` = `$2b$12$…` (60 chars, customer `reksa@gmail.com`); `customer` keys include `password` and `whatsappId`
- **Expected behavior:** the customer password hash never leaves the server
- **Actual behavior:** serialized in admin order responses
- **Recommendation:** replace `include: { customer: true }` with `select: { id?, name, phone }` (or a shared `CUSTOMER_PUBLIC_SELECT`). Not applied: touches the Order/Payment engines (9B PART 19) and is not required for 9B correctness.

### F4 — Canonical revenue predicate duplicated in four 9B raw queries
- **Severity:** MEDIUM
- **Status:** Confirmed / Open (divergence risk; equal today)
- **Exact file:** `src/services/report/report.service.ts`
- **Exact function:** `computeCustomerRevenue`, `getCustomerReport` (activityRows), `getReservationReport` (funnelRows), `getReservationsForExport`
- **Evidence:** the `paymentStatus='PAID' OR EXISTS(payment REFUNDED)` predicate and the `LEAST(refunded/grandTotal,1)` math appear independently in each; `computeCustomerRevenue` net (487000) == canonical net today
- **Expected behavior:** one shared predicate/fragment reused everywhere
- **Actual behavior:** copied predicate; equality is maintained only by manual mirroring
- **Recommendation:** extract the product/refund SQL into a shared `Prisma.Sql` builder. Not applied (refactor; correctness verified equal).

### F2 — CSV export and report disagree on cross-branch `orderId`
- **Severity:** LOW
- **Status:** Confirmed / Open
- **Exact file:** `src/services/report/report.service.ts`
- **Exact function:** `getReservationsForExport` vs `getReservationReport`
- **Evidence:** reservation in MAIN linked to an order in OTHER → report `[MAIN]` revenue 0, export `[MAIN]` row revenue **214000**
- **Expected behavior:** export revenue == report revenue
- **Actual behavior:** export omits the order-branch filter
- **Recommendation:** apply `branchFilters` to the order lookup in `getReservationsForExport`. Not applied (only reachable via an abnormal cross-branch `orderId`; normal flow creates the order in the reservation's branch).

### F3 — Customer report branch scope wider than the operational list
- **Severity:** LOW
- **Status:** Documented design
- **Exact file:** `src/services/report/report.service.ts`
- **Exact function:** `getCustomerReport`
- **Evidence:** `branchFilters=[OTHER]` → `totalCustomers 35` (customers created in period), vs the operational list which requires an order in scope
- **Expected behavior:** branch-scoped admin should not see customer identities whose activity is entirely in another branch
- **Actual behavior:** customers created in the period are included regardless of branch
- **Recommendation:** when `branchFilters` is set, require `orders.some(branchId in scope)`. Not applied — changes "new customers" semantics; documented in PHASE 9B §28.

### F5 — List `orderCount` counts all orders while `totalSpent` is canonical net
- **Severity:** INFO · **Status:** Documented
- **File/Function:** `src/services/customer/customer.service.ts` → `getCustomers`
- **Evidence:** `_count.orders` includes CANCELLED/UNPAID; `totalSpent` = net
- **Expected/Actual:** same tenant+branch scope (satisfied) but different bases (activity vs revenue)
- **Recommendation:** document in the UI or expose both counts.

### F6 — No-show has no timestamp (funnel is a snapshot)
- **Severity:** INFO · **Status:** Documented · **File/Function:** `report.service.ts` → `getReservationReport`
- Derived from `status`; would require a schema field/history table.

### F7 — Reservation revenue date basis differs from the reservation business date
- **Severity:** INFO · **Status:** Documented · **File/Function:** `report.service.ts`
- Scope = `reservationDate`; revenue = `Order.createdAt` / `Refund.approvedAt`.

### F8 — Cross-tenant `orderId` not runtime-testable
- **Severity:** INFO · **Status:** Verified by inspection
- Restaurant B has no branch to host a fixture; protection is the `o.restaurantId` / `restaurantId`
  predicate in every revenue/classification/export query.

---

## 19. Severity Classification

| Severity | Count | IDs |
|---|---|---|
| BLOCKER | 0 | — |
| CRITICAL | 0 | — |
| HIGH | 1 | F1 |
| MEDIUM | 1 | F4 |
| LOW | 2 | F2, F3 |
| INFO | 4 | F5, F6, F7, F8 |

No BLOCKER/CRITICAL in the PHASE 9B change-set.

---

## 20. Remaining Limitations

1. F1 (order/payment customer-hash leak) remains until a dedicated security fix is approved — it is
   outside 9B's files.
2. F2/F3 scoping nuances remain (small, documented).
3. F4: canonical predicate duplication remains (maintenance risk only).
4. Partial-refund reservation revenue not exercised at runtime (no partial refund exists in the DB).
5. C7 (guest/registered classification) intentionally not implemented.
6. `getCustomerReport` is not paginated (cap 5000).

---

## 21. Recommended Next Step

1. **Approve a small, dedicated security fix for F1**: replace `include: { customer: true }` with an
   explicit `select` (name/phone, optionally id) in `order.service.ts` (7 query sites) and
   `payment.service.ts` (2), then re-run `tsc`/`build` + the admin order UI smoke test. This is the
   only HIGH finding and should be prioritised before any PHASE 10 work.
2. Optionally align F2 (order-branch filter in the reservation export) and F3 (branch-scope the
   customer list) in a follow-up hardening pass.
3. Optionally refactor F4 by extracting a shared canonical SQL fragment.
4. **No database migration is recommended** — no demonstrated query-plan problem.

---

## 22. Final Verdict

**PHASE 9B: PASS (with out-of-scope findings).**

- All 12 implemented findings satisfy their documented requirements.
- Canonical revenue is reused and consistent (customer net == Sales Report == `computeRefundRevenue`).
- Customer endpoints no longer leak the password hash; CSV is safe; auth/scope/date validation are correct; no N+1; DB and historical data are intact; no schema/migration.
- `tsc` 0, `build` exit 0, `git diff --check` clean, runtime harness ALL PASS, existing pure tests 27/27.
- One **HIGH pre-existing** finding (F1) is reported but deliberately **not fixed** here (outside the
  9B change-set and outside C1's scope); it should be addressed in an approved follow-up.

**HEAD remains `d7f29ac`. Nothing committed, pushed, or deployed. STOP.**
