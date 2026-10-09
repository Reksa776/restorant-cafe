# PHASE 9B — POST-F4 SEMANTIC REVIEW

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Type:** AUDIT ONLY — no source/schema/migration/seed/data change; no commit/push/deploy; no VPS/production.
**Date:** 2026-10-09
**Sources:** `PHASE9B-F2-F8-AUDIT.md`, `PHASE9B-F2-FIX-REPORT.md`, `PHASE9B-F4-REVENUE-CONSOLIDATION-REPORT.md`,
`PHASE8-FINANCE-CONSISTENCY-AUDIT.md`, `PHASE8B-FINANCE-CONSISTENCY-HARDENING-REPORT.md`, and the current code
(`src/services/report/report.service.ts`, routes, UI).

Definitions used: **CONFIRMED** = proven by code/read-only evidence; **NOT REPRODUCED** = code path exists but
no row triggers it; **policy decision** = business choice, not a code defect.

---

## 1. Exact files, functions, predicates, consumers

### A. Customer revenue refund semantics
- **File:** `src/services/report/report.service.ts`
  - `computeCustomerRevenue` (line 379) — **product half** (line 417): `o.restaurantId = … AND revenueSetSql("o")`
    (i.e. `status <> 'CANCELLED' AND (paymentStatus = 'PAID' OR EXISTS REFUNDED payment)`).
  - `computeCustomerRevenue` — **refund half** (~424–434): joins `approvedRefundsSql(restaurantId, range)`
    (`APPROVED` refunds grouped by `orderId`) to `order o`, `WHERE o.restaurantId = … AND o.status <> 'CANCELLED'`
    only — **no paid predicate** (marked by the F4 comment at line 427).
  - `computeRefundRevenue` (line 274) — **both halves** use `revenueSetSql("o")` (lines 310, 320). This is the
    canonical accounting engine (`PHASE8B` §intro: “accounting engine … unchanged”).
  - Shared fragments: `paidRevenueSql` (528), `revenueSetSql` (541), `refundRevenueSql` (556), `approvedRefundsSql` (574).
- **Consumers of the customer numbers:** `getCustomerReport` → `computeCustomerRevenue({restaurantId, range, branchFilters, customerIds})`
  (`report.service.ts` ~2880) and the reservation-scoped variant (`reservationRevenue`); exposed per row as
  `orders / refund / netSales / aov / reservations.{revenue,refund,netSales}` and in `summary`; consumed by
  `src/app/api/reports/customers/route.ts`, `src/app/api/reports/customers/export/route.ts`,
  `src/app/admin/reports/customers/page.tsx`, and the client wrapper `getCustomerReport`
  (`src/services/report.service.ts`). The operational Customers list (`src/services/customer/customer.service.ts` →
  `getCustomers`) also calls `computeCustomerRevenue` for `totalSpent` (F5).

### B. Reservation funnel `paid`
- **File:** `src/services/report/report.service.ts` → `getReservationReport` (line ~3010), funnel `$queryRaw` (~3130).
- **Predicate:** `SUM(r.orderId IS NOT NULL AND EXISTS (SELECT 1 FROM \`order\` o WHERE o.id = r.orderId AND revenueSetSql("o"))) AS paid`
  (line 3145). The outer query applies `restaurantId`, `reservationDate ∈ range`, and `branchSql` to the
  **reservation** `r`; the inner `EXISTS` has **no `o.branchId` predicate**.
- **Consumers:** `report.summary`/`report.funnel.paid`; API `GET /api/reports/reservations` (requires ADMIN, passes
  `branchFilters = authorizedBranches(ctx)`); CSV `/api/reports/reservations/export` (funnel not in CSV);
  UI `src/app/admin/reports/reservations/page.tsx` (funnel stage labelled **"Dibayar"**);
  client wrapper `reportService.getReservationReport`; type `ReservationReport` (`src/services/report.service.ts:447`,
  `funnel.paid`).

---

## 2. Current semantics and read-only evidence

Read-only run against restaurant A (`cmtois12y0000bzu8o894azsd`) via a temporary script (deleted after use;
`SELECT`/`COUNT` only, no writes):

| Probe | Result |
|---|---|
| Orders / APPROVED refunds / reservations / linked reservations | 35 / 1 / 1 / **0** |
| APPROVED refunds whose order is NOT on the revenue set (cancelled excluded) | **0** |
| Same, without the cancelled exclusion | **0** |
| Orders with `paymentStatus='REFUNDED'` (any) | **0** |
| Linked reservations with cross-branch order (`o.branchId <> rv.branchId`) | **0** |
| Linked reservations with cross-tenant order | **0** |
| Reservations per branch | MAIN: 1 (0 linked) |
| Funnel for restaurant A (no branch filter) | created 1 / **paid 0** |
| Fully-refunded orders on the revenue set (`Σ approved ≥ grandTotal`) | 1 |

### A. Semantics
- **Product** is counted only for revenue-set orders; **refund** in `computeCustomerRevenue` is counted for any
  non-cancelled order with an APPROVED refund in range, **regardless of paid state**.
- Same order set and range: `computeRefundRevenue` (canonical) would exclude an off-set order from **both** halves;
  `computeCustomerRevenue` would still subtract its refund → **negative** `netSales` for that customer.
- **Historical finance rule** (`PHASE8-FINANCE-CONSISTENCY-AUDIT.md` §refund/full-refund; `PHASE8B`): the revenue
  set is `status <> 'CANCELLED' AND (paymentStatus = 'PAID' OR payments.some(REFUNDED))`; a **fully refunded order
  stays in the set** (its PAID payments become REFUNDED, even though `order.paymentStatus → UNPAID`). Refund impact
  is attributed by `approvedAt` on the product basis. The canonical refund half therefore always carries the paid
  predicate; the customer refund half currently does not.

### B. Semantics
- `paid` = **count of in-scope reservations whose linked order is on the canonical revenue set** — a **conversion
  count** ("reservation → paid order"), not a sum of payments, not a payment-state value (UI label "Dibayar";
  type comment at `report.service.ts` ~3155: “reservations whose linked order is on the canonical revenue set”).
- The **reservation** set is branch-scoped; the **linked order** check is **restaurant-wide** (no branch predicate).
- Consequently `paid` and `reservationRevenue` use different branch bases: `reservationRevenue` excludes
  cross-branch linked orders (via `computeRefundRevenue`’s `branchFragment`), while the funnel would count them.

---

## 3. Bug, intentional, or policy decision?

### A. Customer refund predicate difference
- **Classification: latent bug (unintended divergence), currently unreachable.** The 9B customer report copied the
  refund math but omitted the paid predicate; F4 intentionally preserved it to avoid an unapproved semantic change.
  It is **not** an intentional canonical rule: the finance rule (`PHASE8`/`PHASE8B`) puts refunds only on
  revenue-set orders. Under the normal refund flow (PAID payment → REFUNDED), every APPROVED refund sits on an
  order that is PAID or has a REFUNDED payment, so the two engines agree on all reachable data (**0 rows differ**).
- It becomes wrong only for a hypothetical order that carries an APPROVED refund while being neither PAID nor
  holding a REFUNDED payment (e.g. a malformed/legacy refund, or an order later forced off the set).

### B. Funnel `paid` branch scope
- **Classification: policy/definitional decision, not a clear bug.** The funnel answers “how many in-scope
  reservations converted to a paid order?” The reservation is the row being counted; its branch is already the
  scope. Whether the **linked order** must also be inside `branchFilters` is undefined by the current contract.
  The normal reservation→order flow creates the order in the reservation’s own branch, so the two bases coincide;
  the discrepancy is only observable for a cross-branch `orderId` (0 today). It is the same class as F2’s
  cross-branch handling but in a count, not money.

### C. Cross-cutting (worth noting, not asked)
- `paid` also ignores the **date** basis: a reservation in range linked to an order created outside the range still
  counts as `paid`, while `reservationRevenue` excludes that order’s product (F7 / canonical basis). This is
  pre-existing and consistent with “paid = converted”, but means `paid` and `reservationRevenue` can legitimately
  disagree even in-branch.

---

## 4. Expected impact of each possible fix

### A. Add `revenueSetSql` (paid predicate) to `computeCustomerRevenue`’s refund half
- **Effect:** customer `refund`/`netSales`/`aov` (report + operational `totalSpent` + reservation revenue) would
  stop subtracting refunds on off-revenue-set orders. Product half unchanged.
- **On current data:** **zero change** (0 off-set approved refunds; the single approved refund is on a revenue-set
  order). Existing customer totals (all-time product 517000 / refund 30000 / net 487000) would be unchanged.
- **Risk:** narrows a metric; must be approved as a semantic change. If any legacy off-set refund appears later, the
  fix prevents a spurious negative net.
- **Alternative (no code):** document the difference and gate the fix on evidence that such rows exist.

### B. Apply `aliasBranchSql("o", branchFilters)` inside the funnel `EXISTS`
- **Effect:** a reservation linked to an order outside the caller’s branch scope would no longer count as `paid`.
  Brings `paid` onto the same branch base as `reservationRevenue`.
- **On current data:** **zero change** (0 cross-branch links; non-scoped admins pass `branchFilters = undefined`, so
  the added predicate is a no-op). Current funnel values (restaurant A: paid 0) unchanged.
- **Risk:** for a branch-scoped admin, a cross-branch-linked reservation would drop out of `paid`; arguably correct
  but a visible behaviour change if such data ever exists. Also makes `paid` follow the order branch rather than the
  reservation branch, which may be less intuitive for a reservation funnel.
- **Alternative (no code):** keep as-is and document that the funnel’s `paid` stage is reservation-scoped while its
  money (`reservationRevenue`) is order-branch-scoped.

---

## 5. Minimal recommendation and regression risk

- **A (customer refund predicate):** **Do not change the formula in this audit.** Recommend a follow-up,
  separately-approved change that adds `revenueSetSql("o")` to `computeCustomerRevenue`’s refund half so it matches
  the canonical engine, guarded by the existing canonical-equality check. Expected current-data impact: none.
  **Regression risk: LOW** (no reachable row changes; the only effect is on hypothetical off-set refunds).
  If the business prefers no semantic change, document the divergence instead (no code).
- **B (funnel branch scope):** **Preferred minimal = document, not change.** State clearly in the UI/API contract
  that the funnel `paid` stage counts reservations (reservation branch) whose linked order is on the revenue set,
  irrespective of the order’s branch/date, whereas `reservationRevenue` is order-branch- and date-scoped. If strict
  consistency is required, apply `aliasBranchSql("o", branchFilters)` in the `EXISTS`.
  **Regression risk: LOW** (no-op on current data and for non-scoped users).
- **Do not** change either predicate without a separate approval, per the guardrails. Both are unreachable on current
  data, so neither is urgent.

---

## 6. PASS / WARN / BLOCKER verdicts

| Issue | Status | Reproduced on current data? | Verdict | Rationale |
|---|---|---|---|---|
| **A** — `computeCustomerRevenue` refund half omits the paid predicate (diverges from `computeRefundRevenue`) | CONFIRMED (code) / NOT REPRODUCED (runtime) | No (0 off-set approved refunds) | **WARN** | Latent correctness gap; unreachable now because the refund flow keeps orders on the revenue set. Aligning is a semantic change needing approval; impact on current totals = 0. |
| **B** — funnel `paid` is not branch-scoped on the linked order (diverges from `reservationRevenue`) | CONFIRMED (code) / NOT REPRODUCED (runtime) | No (0 cross-branch links) | **WARN** | Definitional/policy ambiguity: `paid` is a reservation conversion count. Adding the branch predicate is a no-op today but is a visible change if cross-branch links ever exist. Document, or align under approval. |

**Overall:** No BLOCKER. Both differences are **WARN** — genuine, documented semantic inconsistencies, currently
unreachable, with zero measured impact on existing totals, and each fixable with a one-line predicate change behind
a policy approval.

---

## Integrity statement

- No `src/` file, schema, migration, seed, or data was modified. The read-only probe used `SELECT`/`COUNT` only and
  was deleted (`ls _p9b*.ts` → none).
- F1, PHASE 9B, F2, and F4 changes are preserved and untouched.
- `git diff -- prisma/` empty; HEAD = `d7f29ac`; no commit/push/deploy.
