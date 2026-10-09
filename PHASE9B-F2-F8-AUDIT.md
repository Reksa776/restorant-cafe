# PHASE 9B — POST-F1 FINDINGS AUDIT (F2–F8)

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac`
**Audit type:** AUDIT ONLY — no source/schema/migration/seed/data change, no commit/push/deploy.
**Date:** 2026-10-09
**Source of truth:** `PHASE9B-POST-AUDIT.md`, `PHASE9B-CUSTOMER-RESERVATION-REPORT-IMPLEMENTATION.md`,
`F1-CUSTOMER-CREDENTIAL-SECURITY-FIX.md`, and the PHASE 9B code under `src/services/report/report.service.ts`.

---

## 0. Method & Scope

- Static reading of the PHASE 9B report code (`report.service.ts`, `customer/customer.service.ts`).
- **Read-only** runtime evidence against the local DB (`DATABASE_URL=…localhost:3306/restaurant_app`,
  restaurant A = `cmtois12y0000bzu8o894azsd`). Reads only via Prisma `findMany/count/aggregate` and the
  report service; a temporary `_p9bf28audit.ts` harness was created and **deleted** after the run.
- The F1 fix (Order/Payment `customer: { select: { id, name, phone } }`, uncommitted) is **preserved
  and untouched**. No file under `src/` was modified by this audit.
- Distinction used below: **CONFIRMED** = reproduced/structurally proven; **NOT REPRODUCED** =
  cannot be triggered on current data but code path exists; **NEEDS POLICY DECISION** = behavior is
  intentional-ish but the desired semantics are a product choice.

Environment facts (read-only):
- Branches for restaurant A: `MAIN` (`cmts9dbpe0000ravmnrjfknin`), `PERUM-1` (`cmts9ma1g0000ljvmw2rl126e`).
- DB counts: orders 35, customers 35, reservations 1, refunds 2. The single reservation has
  `orderId = NULL` (0 linked reservations) → reservation-revenue paths currently operate on an empty
  order set. This bounds what can be reproduced at runtime.

---

## F2 — Reservation CSV revenue disagrees with the report (cross-branch `orderId` + refund-date + duplicate links)

**Severity:** LOW (latent correctness/consistency; unreachable via the normal flow today)

**Status:** **CONFIRMED** (code-level; **cannot be reproduced on current data** — 0 reservations link
an order, so there is no cross-branch `orderId` present).

**Root cause:** `getReservationReport` computes reservation revenue through the canonical engine with
the caller's branch scope, while `getReservationsForExport` re-implements the revenue math in
JavaScript **without** the order-branch filter and **without** the refund approval-date bound.

**Exact file / function / query:**
- Report (correct): `src/services/report/report.service.ts` → `getReservationReport` (line 2961).
  Revenue block at lines 3105–3115 calls
  `computeRefundRevenue({ restaurantId, start: range.start, end: range.end, branchFilters, extraOrderFilter: AND o.id IN (orderIds) })`.
  `computeRefundRevenue` applies `o.branchId IN (branchFilters)` and bounds refunds by
  `rf.approvedAt BETWEEN start AND end`.
- Export (divergent): `src/services/report/report.service.ts` → `getReservationsForExport` (line 3260).
  - Order lookup lines 3319–3340: `prisma.order.findMany({ where: { id: { in: orderIds }, restaurantId } })`
    — **no `branchId` predicate**.
  - Refund lookup lines 3355–3362: `prisma.refund.groupBy({ where: { restaurantId, orderId: { in: orderIds }, status: "APPROVED" }, _sum: { amount } })`
    — **no `approvedAt` bound** (all-time refunds).
  - Per-row math lines 3374–3386:
    ```ts
    const onRevenueSet = order.status !== "CANCELLED" && (order.paymentStatus === "PAID" || order.payments.length > 0);
    const product = grand - num(order.tax) - num(order.serviceCharge);
    const refundRevenue = grand > 0 ? Math.min(refunded / grand, 1) * product : 0;
    revenue = Math.round((product - refundRevenue) * 100) / 100;
    ```

**Evidence:**
- Code: the export order query has no `branchId`; the report's revenue call passes `branchFilters`.
- Prior runtime (PHASE9B-POST-AUDIT §18 F2): reservation in `MAIN` linked to an order in `OTHER`
  → report `[MAIN]` revenue `0`, export `[MAIN]` row revenue `214000`.
- Current read-only audit: `reservations with orderId != null = 0`; `cross-branch orderId = 0`;
  `cross-tenant orderId = 0` → **not reproducible on current data**.
- Additional code-level divergence beyond F2's original description: the export refund lookup is
  **not date-bounded**, so a refund approved outside the report period still reduces the export row
  while the report attributes it to its approval period. Also, if **two reservations share one
  `orderId`**, the report counts that order's revenue once (SQL `IN` set dedup) while the export
  prints it on **each** row → CSV column sum ≠ report `reservationRevenue`.

**Impact aktual:** Latent. No live data triggers it (single reservation, no link, and the normal
reservation→order flow creates the order in the reservation's own branch). If triggered, the CSV
export under-reports (branch-excluded) or mis-reports (date/duplicate) versus the on-screen report.

**Rekomendasi minimal:** In `getReservationsForExport`, apply the same scope as the report:
(1) add `branchId: { in: branchFilters }` to the order lookup when `branchFilters` is set;
(2) bound the refund lookup by `approvedAt: { gte: range.start, lte: range.end }`;
(3) optionally route per-row revenue through the canonical order-id set (or document that per-row
export intentionally repeats a shared order's revenue). No new engine.

**Tenant implications:** None — `restaurantId` is present on the order lookup. Tenant-safe.
**Branch implications:** The core of the finding; export ignores the order-branch filter.
**Migration impact:** None.
**Regression risk:** LOW (export-only path; additive predicate). Note the refund-date bound changes
exported numbers to match the report, which is the intended behavior.

---

## F3 — Customer report includes period-created customers regardless of branch

**Severity:** LOW (branch-scope widening of the customer *identity* list; no cross-branch financial data)

**Status:** **CONFIRMED** — reproduced on current data. Remediation semantics are a
**policy decision**.

**Root cause:** `getCustomerReport` selects customers whose `activityOrNew` OR-clause includes
"created in period" **without** the `branchWhere`, so a branch-scoped caller receives rows for
customers created in the period even when they have no activity in the caller's branch. Per-customer
activity/revenue metrics are branch-scoped, so those rows simply show zero activity.

**Exact file / function / query:** `src/services/report/report.service.ts` → `getCustomerReport`
(line 2650).
- `activityOrNew` (lines 2677–2690):
  ```ts
  OR: [
    { createdAt: { gte: range.start, lte: range.end } },              // <- NOT branch-scoped
    { orders: { some: { status: { not: "CANCELLED" }, createdAt: {...}, ...branchWhere } } },
  ]
  ```
- Customer select lines 2701–2718 takes up to `CUSTOMER_REPORT_MAX_ROWS` (5000).
- Branch-scoped metrics: `activityRows` (line 2735, `orderBranchSql`), `reservationRows`
  (`resvBranchSql`), and `computeCustomerRevenue({ branchFilters })`.

**Evidence (read-only, this audit):**
| Call | totalCustomers | rows with `activityOrders === 0` | newCustomers |
|---|---|---|---|
| `branchFilters=[MAIN]` | 35 | 20 | 35 |
| `branchFilters=[PERUM-1]` | 35 | 23 | 35 |

The operational list (`customerService.getCustomers` with the same branch filter) requires
`orders.some.branchId in branchFilters`, so it would **not** return those zero-activity rows. The
report is therefore wider than the operational list for the same branch.

**Impact aktual:** A branch-scoped admin sees the name/phone/email of customers created in the period
who never transacted in their branch (`20`/`23` of `35` rows), and `newCustomers=35` regardless of
branch. No cross-branch revenue or order count is exposed (those remain branch-scoped). It is an
identity/PII exposure and a semantic mismatch, not a financial leak.

**Rekomendasi minimal:** When `branchFilters` is set, require in-scope activity for the *identity*
list too (drop the un-scoped `createdAt` branch, or AND it with `orders.some(branchWhere)`), **or**
explicitly label the summary "customers created in period (restaurant-wide)" vs. "active in branch".
Either is small; the choice changes the meaning of "new customers", hence policy.

**Tenant implications:** None (`restaurantId` scoped). **Branch implications:** The finding itself.
**Migration impact:** None. **Regression risk:** LOW–MEDIUM (changes `totalCustomers`/`newCustomers`
for branch-scoped callers only).

---

## F4 — Canonical revenue predicate is duplicated in four 9B raw queries

**Severity:** MEDIUM (maintenance / divergence risk; numerically equal today)

**Status:** **CONFIRMED**.

**Root cause:** The canonical engine exposes only branch-grouped helpers, so the PHASE 9B report code
copied the "revenue set" predicate (`status <> 'CANCELLED' AND (paymentStatus = 'PAID' OR EXISTS
payment REFUNDED)`) and the refund math (`LEAST(refunded/grandTotal,1) × (grandTotal − tax −
serviceCharge)`) into several independent queries instead of reusing one shared SQL fragment.

**Exact file / function / query (all in `src/services/report/report.service.ts`):**

| # | Site | Form |
|---|---|---|
| Canonical | `computeRefundRevenue` (line 250; predicate 314/342, refund math 323) | SQL — the source of truth |
| 1 | `computeCustomerRevenue` (line 403; product 448, refund 460) | SQL copy grouped by customer |
| 2 | `getCustomerReport` → `activityRows` (line 2735) | predicate inline **5×** (lines 2735/2738/2741/2744) |
| 3 | `getReservationReport` → funnel `paid` subquery (line 3097) | predicate inline |
| 4 | `getReservationsForExport` (lines 3374–3386) | **JS** re-implementation of product/refund math |

**Evidence:** `grep` of `paymentStatus = 'PAID'` / `REFUNDED` / `LEAST(` in `report.service.ts` →
29 matches, of which the above are the 9B additions. Runtime equality holds today:
`computeCustomerRevenue.total = computeRefundRevenue.total = { product 517000, refund 30000, net
487000 }` for restaurant A all-time (re-verified this audit).

**Impact aktual:** No present numeric error; the risk is that a future change to the canonical rule
(element 1–4) silently diverges. F2 is an instance of exactly this drift (the JS copy lost the
branch/date conditions).

**Rekomendasi minimal:** Extract the product/refund SQL into a shared `Prisma.Sql` builder (e.g.
`revenueSetSql({ alias, restaurantId, range, branchFilters, extraOrderFilter })`) and rebuild sites
1–4 from it. Pure refactor; no behavior change. **Do not** merge this with F2's fix unless F2 is
already handled, to keep the change reviewed.

**Tenant implications:** None if the shared builder always injects `restaurantId`.
**Branch implications:** Reduces the chance of another branch-scope drift like F2.
**Migration impact:** None. **Regression risk:** LOW (refactor guarded by the runtime equality check).

---

## F5 — Customer list `orderCount` (activity) vs `totalSpent` (canonical net) use different bases

**Severity:** INFO

**Status:** **CONFIRMED** (semantics), documented.

**Root cause:** By design, the list shows an **activity** count and a **revenue** sum:
`orderCount = _count.orders` (all orders, incl. CANCELLED/UNPAID/FAILED/EXPIRED) while
`totalSpent = computeCustomerRevenue(...).netSales` (canonical revenue set only). Both are
branch-scoped (PHASE 9B C3), so they share scope but not basis.

**Exact file / function / query:** `src/services/customer/customer.service.ts` → `getCustomers`
(line 28): `_count: { select: countSelect }` and `totalSpent` from `computeCustomerRevenue`.

**Evidence (read-only, this audit):** of 35 list rows, **17** have
`listOrderCount (activity) != canonicalRevenueOrderCount`; the samples are customers with
`orderCount = 1`, canonical revenue orders `0`, `totalSpent "0"` (e.g. cancelled/never-paid orders).
The customer **report** separately exposes `orders` (revenue-set count) and `activityOrders`, so the
list's `orderCount` also does not equal the report's `orders`.

**Impact aktual:** A user comparing the Customers list to the Customer report sees different order
counts for the same customer. No financial error; it is a labelling/semantics gap.

**Rekomendasi minimal:** Relabel the column (e.g. "Orders (activity)" vs "Net Spend") or expose both
counts. No data/model change.

**Tenant implications:** None. **Branch implications:** Both metrics share the branch filter.
**Migration impact:** None. **Regression risk:** LOW (UI label only).

---

## F6 — No-show has no dedicated timestamp

**Severity:** INFO (data-model limitation)

**Status:** **CONFIRMED** (schema fact).

**Root cause:** The reservation funnel derives stages from the current `status` column plus
`confirmedAt/seatedAt/completedAt`, but there is **no `noShowAt`** column (and no
`ReservationStatusHistory`), so NO_SHOW can only be counted as a current-status snapshot, with
`updatedAt` as the only (implicit) time signal.

**Exact file / query:**
- `prisma/schema.prisma` → `model Reservation`: has `confirmedAt, seatedAt, completedAt, cancelledAt`
  but **no `noShowAt`**.
- `src/services/report/report.service.ts` → `getReservationReport` funnel SQL (line ~3090):
  `SUM(r.status = 'NO_SHOW') AS noShow` (status-based, not time-ordered).

**Evidence:** schema dump confirms the absence; funnel output `noShow: 0` for the single CONFIRMED
reservation.

**Impact aktual:** Cannot do time-ordered no-show/drop-off analysis. Counts/rates (current status) are
correct and sufficient for the implemented static funnel.

**Rekomendasi minimal:** None for the current static funnel; document the limitation. Only if
time-ordered no-show analytics is required: add an **additive** `noShowAt DateTime?` (or a history
table, larger change). Not recommended now.

**Tenant implications:** N/A. **Branch implications:** N/A.
**Migration impact:** None now; additive column/history table only if the analytics are ever required.
**Regression risk:** LOW.

---

## F7 — Reservation revenue uses a different date basis than the reservation business date

**Severity:** INFO (documented design)

**Status:** **CONFIRMED** (intentional; **NEEDS POLICY DECISION** only if business wants
business-date-aligned booking-period revenue).

**Root cause:** The reservation report is scoped by `Reservation.reservationDate` (the business day
reserved), but its revenue is attributed to the linked order's `createdAt` and to refunds by
`Refund.approvedAt` (canonical basis), which may fall in a different calendar period — a reservation
booked today for next week contributes reservation **count** to next week's report but revenue to
today's report.

**Exact file / query:** `src/services/report/report.service.ts`:
- `resolveReservationDateRange` (line 515) → `baseWhere.reservationDate` (report scope).
- `getReservationReport` revenue call (lines 3105–3115) → `computeRefundRevenue({ start: range.start, end: range.end })`
  which bounds the order half by `o.createdAt` and the refund half by `r.approvedAt`.

**Evidence:** code inspection; the single reservation has no linked order, so no cross-period case
exists to observe. The report does expose `createdAt` in the export and documents the basis in code
comments.

**Impact aktual:** Period totals for reservation revenue may not equal the sum of "reservations with
`reservationDate` in period" revenue; this is deliberate canonical-consistency, and identical to how
every other report attributes revenue by order/refund date.

**Rekomendasi minimal:** Keep the canonical basis (do not diverge). Ensure the UI label states
"reservation revenue is attributed by order/payment date" so users do not expect business-date
alignment. Alternative (policy): a second, clearly-labelled "booked-in-period" revenue view — not
recommended in this phase.

**Tenant implications:** None. **Branch implications:** None.
**Migration impact:** None. **Regression risk:** LOW.

---

## F8 — Cross-tenant `orderId` protection is structural, not constraint-enforced

**Severity:** INFO (structurally safe; no DB-level guarantee)

**Status:** **CONFIRMED** structurally; **NOT REPRODUCED** at runtime (restaurant B has no branch to
host a fixture; only restaurant A has linked data — and it has none).

**Root cause:** `Reservation.orderId` is a nullable **scalar with no Prisma relation / FK** to
`Order`. Nothing at the database level prevents a reservation row from holding another tenant's
order id; safety relies entirely on application predicates.

**Exact file / query:**
- `prisma/schema.prisma` → `model Reservation`: `orderId String?` with no `@relation`, no FK, no index.
- Guards: `computeRefundRevenue` (`o.restaurantId = ${restaurantId}`, report.service.ts line 300),
  `getReservationReport` order payment groupBy (`where: { id: { in: orderIds }, restaurantId }`,
  line 3105), `getReservationsForExport` order lookup (`where: { id: { in: orderIds }, restaurantId }`,
  line 3320), and `getCustomerReport` reservation-order lookup (`where: { restaurantId, … }`).

**Evidence (read-only, this audit):** `reservations with orderId != null = 0`; therefore
`cross-tenant orderId = 0` and `cross-branch = 0` — no violation exists, but also the guard cannot be
exercised on current data. Read-only inspection confirms every revenue/classification/export query
carries `restaurantId`.

**Impact aktual:** None on current data. Residual risk is a future data-integrity bug (a bad write
setting `orderId` across tenants) being caught only by query predicates, not the DB.

**Rekomendasi minimal:** Keep the existing predicates (they are correct). Optional hardening, if
desired, is a **policy/schema** decision: add `@@index([orderId])` for the join (C14 — only if
measured necessary) and/or a runtime invariant test. A real FK would require a relation on `Order`
(intentionally untouched) — **not recommended** in this phase.

**Tenant implications:** App-layer isolation only; no DB FK. **Branch implications:** The report
correctly excludes a cross-branch order via `branchFilters` (F2 is the export-side exception).
**Migration impact:** None (optional additive index only).
**Regression risk:** LOW.

---

## Severity & Status Summary

| ID | Severity | Status | Reproduced on current data? | Migration? |
|---|---|---|---|---|
| F2 | LOW | CONFIRMED (code) / NOT REPRODUCED (runtime) | No (0 linked reservations) | No |
| F3 | LOW | CONFIRMED | Yes (20/35 and 23/35 zero-activity rows) | No |
| F4 | MEDIUM | CONFIRMED | N/A (equality verified; risk is maintenance) | No |
| F5 | INFO | CONFIRMED | Yes (17/35 rows differ) | No |
| F6 | INFO | CONFIRMED (schema) | N/A | No (additive only if policy changes) |
| F7 | INFO | CONFIRMED (design) | No (no cross-period link) | No |
| F8 | INFO | CONFIRMED (structural) / NOT REPRODUCED | No (no linked data) | No |

---

## Recommended Implementation Priority (for a future, separately-approved phase)

1. **F4 (MEDIUM)** — extract the shared canonical revenue SQL fragment and rebuild the 4 sites from
   it. Highest leverage: it removes the class of drift that produced F2, and is a behavior-preserving
   refactor guarded by the existing canonical-equality check.
2. **F2 (LOW)** — align `getReservationsForExport` with the report (order-branch filter + refund
   approval-date bound) as part of/after F4. Small, export-only.
3. **F3 (LOW, policy)** — decide whether a branch-scoped Customer report should require in-scope
   activity; then apply the minimal query change and document the "new customer" definition.
4. **F5 (INFO)** — relabel the Customers list column (activity vs canonical net) or expose both
   counts.
5. **F6 (INFO)** — document the static-funnel/no-`noShowAt` limitation; no code change.
6. **F7 (INFO)** — document the revenue date basis in the UI; keep canonical.
7. **F8 (INFO)** — keep predicates; optional additive `@@index([orderId])` only if the reservation
   revenue join is ever measured slow.

**No migration is required for any finding as it stands.** F6/F8 would need only *additive* schema
changes and only if a future policy explicitly requires time-ordered no-show analytics or a
DB-enforced reservation↔order link — neither is part of PHASE 9B.

---

## Integrity Statement

- No `src/` file, schema, migration, seed, or data was modified by this audit.
- The F1 fix remains in the working tree, uncommitted and intact.
- Historical order `ORD-20260908-HCOK1L` (`CANCELLED` / `PAID`) was not touched.
- Temporary audit harness `_p9bf28audit.ts` was removed after the read-only run.
- `git status --porcelain -- prisma/` = empty; `HEAD = d7f29ac`.

**STOP — audit only, no coding. Awaiting instruction.**
