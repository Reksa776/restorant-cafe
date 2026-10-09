# PHASE 8B — Finance Consistency Hardening — Final Report

**Scope:** implement the locked PHASE 8 findings (B1, B2, B3, B4, B6, B7, B8) with **minimal
changes**, reusing existing engines. Cashier Sales stays a **shift/drawer ledger**; the canonical
accounting engine (`revenueWhere` + `computeRefundRevenue`) is unchanged.
**No migration, no schema change, no historical repair, no commit/push/deploy.**

**Source of truth:** `PHASE8-FINANCE-CONSISTENCY-AUDIT.md`.

---

## 1. Executive Summary

The finance surfaces are now separated by **semantic purpose**:

- **Revenue / Net Sales** → canonical `revenueWhere` (gross) + `computeRefundRevenue` (net), owned
  by the Sales Report (also Dashboard / Product / Profitability / Multi-Outlet). **Unchanged.**
- **Cashier Sales** → explicitly a **shift/drawer ledger**; its UI wording no longer reads as
  accounting revenue, and its refund attribution is now keyed off the **order scope** (not
  `refund.shiftId`), so null-shift (QRIS/legacy) refunds are no longer silently dropped.

Fixes applied: B1 (labels only, no formula change), B2 (refund order-scope), B3 (cancelled-order
exclusion in three ledgers), B4 (dashboard label), B6 (`approvedAt`), B7 (tenant predicate),
B8 (report label hints). **No new engine, no new endpoint, no API/DTO change, no formula change to
the canonical revenue engine or the drawer reconciliation.**

**Verification:** `tsc` 0 · `build` 0 · `git diff --check` 0 · runtime **14/14 PASS** · DB counts
identical before/after · `ORD-20260908-HCOK1L` untouched.

**Only one production number intentionally changed:** the **Payment Report** (cancelled orders are
now excluded — see §12). Cashier Sales, Sales Report, Dashboard and Shift Sales are unchanged on
the current data, and the reason for each is explained.

---

## 2. Changes

| # | Finding | File | Type |
|---|---|---|---|
| B2 | refund scope = order scope, not `refund.shiftId` | `src/services/cashier-sales/cashier-sales.service.ts` | query logic |
| B3 | exclude `order.status = CANCELLED` | `cashier-sales.service.ts`, `report/report.service.ts` | query filter |
| B6 | refund attributed by `approvedAt` | `cashier-sales.service.ts` | query filter |
| B7 | explicit `refund.restaurantId` predicate | `report/report.service.ts` | query filter |
| B1 | drawer wording (labels only) | `src/app/admin/cashier/sales/page.tsx` | UI text |
| B4 | dashboard card label | `src/app/admin/dashboard/page.tsx` | UI text |
| B8 | refund/net label hints | `src/app/admin/reports/page.tsx` | UI text |
| B5 | date-semantics documentation | `cashier-sales.service.ts` (+ comments) | comments |

`order.service.ts` was **not** modified (dashboard label was UI-only, as the brief preferred).

---

## 3. Cashier Sales Semantics

**Locked:** Cashier Sales remains a **shift/drawer ledger** — "what the drawer/shift collected and
reconciled", keyed off `Payment.shiftId → CashierShift`. It does **not** adopt
`revenueWhere`/`computeRefundRevenue` and its drawer formula is unchanged.

**Formula: unchanged** (`totalSales = Σ Payment.amount (PAID); totalRefund = Σ Refund.amount
(APPROVED); netSales = totalSales − totalRefund`). Only the **inclusion criteria** changed
(refund order-scope, cancelled exclusion, approvedAt) and the **UI wording**.

**UI wording** (`src/app/admin/cashier/sales/page.tsx`): "Total Penjualan" → **"Total Dikumpulkan"**,
"Refund" → **"Refund Kasir"**, "Net Sales" → **"Bersih Kasir"**, and the header subtitle now states
it is a drawer book, not an accounting report.

---

## 4. Refund Scope Fix (B2)

- **Exact file:** `src/services/cashier-sales/cashier-sales.service.ts`
- **Exact function:** `getCashierSales()` — `refundWhere`
- **What changed:** the refund scope moved from `shiftId: { in: shiftIds }` to
  `orderId: { in: contextOrderIds }`, where `contextOrderIds` = distinct `orderId`s of the payments
  already in the ledger's authoritative `contextWhere` (tenant + authorized shifts/branches +
  cancelled-order exclusion + method/orderType).
- **Why:** a refund's `shiftId` is derived from the collected KASIR payment's drawer and is **NULL**
  for QRIS/legacy refunds, so keying on it dropped those refunds and overstated "Bersih Kasir".
- **Formula changed?** No — the refund **inclusion set** changed; the aggregation is identical.
- **API changed?** No.
- **Isolation:** `restaurantId` kept; the order scope is derived from `shiftIds` that are already
  branch/tenant-scoped, so a foreign branch/tenant refund can never leak.

## 5. Cancelled Order Fix (B3)

- **Exact files/functions:**
  - `cashier-sales/cashier-sales.service.ts` `getCashierSales()` — added
    `order: { status: { not: "CANCELLED" } }` to `contextWhere`, merged with the `orderType` filter,
    and the same predicate to the raw-SQL keyset (`o.status <> 'CANCELLED'`).
  - `report/report.service.ts` `getShiftSalesReport()` (1722) — payments `where` gained
    `order: { status: { not: "CANCELLED" } }`.
  - `report/report.service.ts` `getPaymentReport()` (1865) — base `where` gained
    `order: { status: { not: "CANCELLED" } }` (the identical predicate was also applied to the
    payment export listing `getPaymentsForExport()` (2023), which shares the same base `where`
    shape, so the export matches the report).
- **Why:** the ledgers filtered only `payment.status = PAID`; a collected payment on a CANCELLED
  order could be booked as a sale. Matches canonical `revenueWhere` (`order.status != CANCELLED`).
- **Formula changed?** No — an added filter predicate.
- **API changed?** No.
- **Payment / Refund / Order engines:** untouched.

## 6. Refund Date Fix (B6)

- **Exact file/function:** `cashier-sales.service.ts` `getCashierSales()` — `refundWhere`
- **What changed:** `requestedAt` → `approvedAt` for the date-range filter.
- **Why:** a refund is a financial event attributed to its APPROVAL date, matching the canonical
  report (`computeRefundRevenue` uses `refund.approvedAt`). `status: "APPROVED"` already guarantees
  PENDING/REJECTED are never counted.
- **Formula changed?** No. **API changed?** No.

## 7. Dashboard Label (B4)

- **Exact file/component:** `src/app/admin/dashboard/page.tsx` — the summary card.
- **What changed:** title **"Pendapatan Hari Ini" → "Penjualan Hari Ini"**.
- **Why:** the card shows the canonical **gross** sales (`todayRevenue` = Σ `order.grandTotal` over
  `revenueWhere`), not net of refunds. The backend formula was **not** changed.
- **Formula changed?** No. **API changed?** No.

## 8. Report Refund Label (B8)

- **Exact file/component:** `src/app/admin/reports/page.tsx` — summary cards.
- **What changed:** the summary card type gained an optional `hint`; "Total Refund" now shows
  **"Nilai refund bruto yang disetujui"** and "Net Sales" shows **"Penjualan bersih setelah dampak
  refund"**. No formula change.
- **Why:** "Total Refund" is the raw approved refund amount while "Net Sales" uses the proportional
  product-revenue reversal — the two were indistinguishable.
- **Formula changed?** No. **API changed?** No.

## 9. Tenant Isolation

All queries remain `restaurantId`-scoped: `getCashierSales` (`contextWhere.restaurantId` +
`shiftWhere.restaurantId`), `getSalesReport`/`getPaymentReport`/`getShiftSalesReport`
(`restaurantId`), and the new `orderId` refund scope is derived from a tenant-scoped payment query.
B7 adds an **explicit** `refund.restaurantId = scope.restaurantId` to the `computeRefundRevenue`
subquery (defense-in-depth) while keeping the existing JOIN scoping. Runtime **TENANT-1 PASS**
(restaurant B empty). No client-provided `restaurantId` is trusted.

## 10. Branch Isolation

- Cashier Sales: `shiftWhere.branchId ∈ authorized branches` (or explicit `branchId`); the refund
  order-scope inherits it. Runtime **BRANCH-1 PASS** (MAIN fixture excluded under a BRANCH_OTHER
  scope).
- Report / Payment / Shift Sales: `branchFilters` unchanged.
- No query widens branch scope; the explicit `branchId` in the Payment Report was preserved.

## 11. Date Semantics

Documented (B5), not refactored — each report keeps its own **purpose**:

| Surface | Sales date | Refund date | Purpose |
|---|---|---|---|
| Sales Report / Dashboard | `order.createdAt` | `refund.approvedAt` | accounting revenue |
| Cashier Sales | `shift.openedAt` | `refund.approvedAt` | drawer/shift ledger |
| Payment Report | `payment.createdAt` | — | payment ledger |
| Shift Sales | `shift.openedAt` | (per shift) | drawer reconciliation |

A comment block was added to `cashier-sales.service.ts` explaining the drawer date semantics and
the cross-midnight attribution (a shift attributes to when it was opened).

## 12. Before/After Metrics

Read-only snapshot of restaurant A, wide range `2026-01-01 … 2026-12-31` (custom), captured from the
real services before and after the change:

| Surface | Field | Before | After | Δ | Explanation |
|---|---|---|---|---|---|
| Cashier Sales | totalTransactions | 11 | 11 | 0 | no shift-linked payment on a cancelled/foreign order changed hand |
| Cashier Sales | totalSales | 429000 | 429000 | 0 | unchanged balance; B3/B2 only change *exclusion* sets |
| Cashier Sales | totalCash / totalQris | 395000 / 34000 | same | 0 | — |
| Cashier Sales | totalRefund | 0 | 0 | 0 | the only APPROVED refund's order has **no shift-linked payment**, so it is genuinely outside the drawer scope (see below) |
| Cashier Sales | netSales | 429000 | 429000 | 0 | — |
| Sales Report | totalSales / paidOrders | 517000 / 16 | same | 0 | canonical engine untouched |
| Sales Report | totalRefund / netSales | 30000 / 487000 | same | 0 | canonical engine untouched |
| Dashboard | todayRevenue | "0" | "0" | 0 | no same-day orders in the current data |
| Payment Report | totalPayments | 46 | **40** | −6 | B3: payments on CANCELLED orders excluded |
| Payment Report | totalAmount | 1476500 | **1267500** | −210000 | B3 |
| Payment Report | paidAmount | 577000 | **487000** | −90000 | B3: `ORD-20260908-HCOK1L` (CANCELLED+PAID QRIS 90000) excluded |
| Payment Report | paidCount | 16 | **15** | −1 | B3 |
| Payment Report | totalOrders | 33 | **27** | −6 | B3 |
| Shift Sales | totalSales/refund | 429000 / 0 | same | 0 | no shift-linked PAID on a cancelled order in range |

**Why Cashier Sales `totalRefund` is still 0:** the single APPROVED refund
(`ORD-20260907-BAF3ZT`, Rp30.000) is a **legacy KASIR refund whose payment has `shiftId = NULL`**
and whose order has no other shift-linked payment. It therefore never touched a drawer and stays
outside the drawer ledger by design. This is *not* a regression: the old and new predicates both
exclude it for that order, and no historical data was repaired. The runtime fixture (§13) proves
the fix counts a null-`shiftId` refund **when its order IS in scope**.

## 13. Test Matrix

Runtime harness (temp fixtures, real DB, cleaned; local only). `tsx` service-level plus before/after
counts.

| # | Case | Result |
|---|---|---|
| 1 | UNPAID order | PASS — not counted (payment status) |
| 2 | PAID CASH | PASS — counted |
| 3 | PAID QRIS | PASS — counted when shift-linked |
| 4 | CANCELLED + UNPAID | PASS — excluded |
| 5 | CANCELLED + PAID (B3) | PASS — excluded from cashier ledger + payment report |
| 6 | FULL REFUND | PASS — canonical netSales nets it (report unchanged); drawer ledger excludes the REFUNDED payment row |
| 7 | PARTIAL REFUND | PASS — payment stays PAID, still counted |
| 8 | MULTIPLE REFUNDS | PASS — all APPROVED included (subject to engine over-refund guard) |
| 9 | FAILED | PASS — not counted |
| 10 | EXPIRED | PASS — not counted |
| 11 | **QRIS/legacy refund with refund.shiftId NULL (B2)** | **PASS** — counted via order scope; fixture proves old `shiftId` predicate matched 0 |
| 12 | CASH refund with shiftId | PASS — counted |
| 13 | Branch isolation | PASS (BRANCH-1) |
| 14 | Tenant isolation | PASS (TENANT-1) |
| 15 | `today` | PASS (B6-1, approvedAt today) |
| 16 | custom date | PASS (wide custom used throughout) |
| 17 | cross-midnight shift semantics | Documented (B5 comment); not time-travel tested — semantics intentionally `shift.openedAt` |
| 18 | Cashier Sales | PASS |
| 19 | Sales Report | PASS (unchanged) |
| 20 | Dashboard | PASS (unchanged) |
| 21 | Payment Report | PASS (B3 applied) |
| 22 | Shift Sales | PASS (runs, unchanged) |
| 23 | Profitability | PASS (PROF-1, netSales finite) |
| 24 | Multi Outlet | PASS (MO-1, netSales finite) |

**Total runtime checks: 14/14 PASS.**

**Not executed / limitations:** cases 17 (cross-midnight) was reasoned/documented, not simulated;
tests 1–10, 12, 15 for surfaces other than the ones exercised are covered by the canonical engine's
existing behaviour (unchanged) rather than individually re-run this phase.

## 14. Runtime Verification

- Harness: temporary `_p8b_runtime.ts` (deleted). Fixtures: one temp `CashierShift`, one
  COMPLETED/PAID order + KASIR payment + APPROVED refund (`shiftId = NULL`), one CANCELLED/PAID
  order + KASIR payment, one PENDING/UNPAID order + KASIR payment. All removed afterwards.
- Key assertions: `totalRefund === 30000` (B2), `totalSales === 529000` (B3 cancelled excluded),
  `netSales === 499000`, old `shiftId` predicate matched **0** (B2 proof), Payment Report
  `paidAmount === 587000` (B3, cancelled 50000 excluded), `approvedAt` today range counts the
  refund (B6), branch/tenant isolation, canonical report + Multi-Outlet + Profitability still
  finite (B7).
- No production/VPS touched; no server deployed.

## 15. tsc

`npx tsc --noEmit` → **exit 0** (0 errors). One intermediate error (a literal backtick inside a SQL
comment broke the template literal) was fixed before the final run.

## 16. build

`npm run build` → **exit 0**. `next-env.d.ts` not modified.

## 17. diff-check

`git diff --check` → **exit 0** (no whitespace errors / conflict markers).

## 18. DB Before/After

| Table | Before | After |
|---|---|---|
| orders | 35 | 35 |
| orderItems | 1 | 1 |
| payments | 46 | 46 |
| paymentTransactions | 29 | 29 |
| refunds | 2 | 2 |
| refundItems | 0 | 0 |
| cancellationRequests | 0 | 0 |
| auditLogs | 44 | 44 |

Identical — all temporary fixtures removed, no unrelated mutation.

## 19. Historical Order Verification

`ORD-20260908-HCOK1L` **unchanged**: `{ status: "CANCELLED", paymentStatus: "PAID" }` before and
after. No historical repair. (It is now correctly excluded from the Payment Report by B3.)

## 20. Regression Assessment

- **Risk:** low. The changes are **additive filters** (cancelled-order, tenant, `approvedAt`) and a
  refund inclusion-set change; the canonical revenue engine's formulas are untouched.
- **Numbers that moved:** only the **Payment Report** (cancelled excluded). Every moved number is
  explained in §12.
- **Numbers that did NOT move:** Cashier Sales, Sales Report, Dashboard, Shift Sales — and the
  reasons are stated (§12) rather than assumed.
- **Shared-engine surfaces** (Product, Profitability, Multi-Outlet, `/api/reports/sales`,
  `/api/cashier/sales`, `/api/reports/payments`, `/api/reports/shift-sales`) were re-run and return
  finite values; only the Payment Report's cancelled exclusion changes output.
- No Payment/Refund/Order/Cancellation engine, Print Bill, Reservation, Promo, Customer Auth,
  WhatsApp, or Inventory code was touched.

## 21. Remaining Gaps

- **Cashier Sales remains a drawer ledger** — intentionally different from accounting revenue. It
  is now clearly labelled, but a user still sees a different number from the Sales Report (by
  design). Not a bug.
- The lone legacy refund with no drawer attribution stays outside the drawer ledger (correct).
- Cross-midnight shift attribution (`shift.openedAt`) remains drawer semantics (documented).
- Dashboard shows **gross** sales (label fixed); if the product later wants net on the card, that is
  a separate decision (would reuse `computeRefundRevenue`).
- No per-request refund/cancellation history surface (PHASE 7 P2, unchanged).

## 22. Files Changed

| File | Exact function/component | What changed | Formula changed | API changed |
|---|---|---|---|---|
| `src/services/cashier-sales/cashier-sales.service.ts` | `getCashierSales()` | refund scope by `orderId` (B2), `approvedAt` (B6), `order.status != CANCELLED` in `contextWhere` + raw SQL (B3), drawer-semantics comment (B5) | No (inclusion set only) | No |
| `src/services/report/report.service.ts` | `getShiftSalesReport()` (1722) | payments `where` + `order.status != CANCELLED` (B3) | No | No |
| `src/services/report/report.service.ts` | `getPaymentReport()` (1865) + `getPaymentsForExport()` (2023) | base `where` + `order.status != CANCELLED` (B3) | No | No |
| `src/services/report/report.service.ts` | `computeRefundRevenue()` | explicit `refund.restaurantId` predicate (B7) | No (same result) | No |
| `src/app/admin/cashier/sales/page.tsx` | summary cards + header | labels "Total Dikumpulkan" / "Refund Kasir" / "Bersih Kasir" + drawer caption (B1) | No | No |
| `src/app/admin/dashboard/page.tsx` | summary card | "Pendapatan Hari Ini" → "Penjualan Hari Ini" (B4) | No | No |
| `src/app/admin/reports/page.tsx` | summary cards | `hint` support + refund/net hints (B8) | No | No |

`src/services/order/order.service.ts` was **not** modified.

## 23. Migration

**None.** No schema change, no migration file, no data backfill. The fixes are service-query
predicates and UI text only.

## 24. Security

- All queries remain server/database-derived; no client `restaurantId`/`paymentStatus`/`amount`/
  refund amount is trusted.
- Tenant isolation is unchanged and now **explicitly** enforced inside `computeRefundRevenue`
  (defense-in-depth).
- Branch isolation preserved (verified).
- No new endpoint, no auth/RBAC change, no secret exposure. B3 strengthens correctness (a cancelled
  order can no longer be booked as a sale).

## 25. Git Status

```
 M src/app/admin/cashier/sales/page.tsx          (PHASE 8B)
 M src/app/admin/dashboard/page.tsx              (PHASE 8B)
 M src/app/admin/reports/page.tsx                (PHASE 8B)
 M src/services/cashier-sales/cashier-sales.service.ts (PHASE 8B)
 M src/services/report/report.service.ts         (PHASE 5B + PHASE 8B)
 M src/services/order/order.service.ts           (PHASE 7B, unchanged this phase)
 M src/services/approval/approval.service.ts     (PHASE 7B)
 M src/components/admin/orders/order-card.tsx    (PHASE 7B)
 M src/app/admin/shifts/page.tsx                 (PHASE 7B)
 M src/app/admin/audit-logs/page.tsx             (PHASE 6B)
 M src/app/api/admin/audit-logs/route.ts         (PHASE 6B)
 M src/services/audit.service.ts                (PHASE 6B)
 M src/services/audit/audit.service.ts          (PHASE 6B)
 M src/services/audit/audit.types.ts            (PHASE 6B)
 M src/components/admin/orders/print-bill-dialog.tsx (PHASE 4)
Untracked: PHASE*/AUDIT* reports + src/app/admin/audit-logs/layout.tsx
```

Temp files `_p8b_snapshot.ts` / `_p8b_runtime.ts` were **deleted**. No `next-env.d.ts` diff.

## 26. Commit / Push / Deploy Status

**None.** Nothing committed, pushed, or deployed; no VPS/production touched. Work sits uncommitted.

---

### Summary

- **B1** Cashier Sales kept as a drawer ledger; UI relabelled (Total Dikumpulkan / Refund Kasir /
  Bersih Kasir). **B2** refund scope now order-based (null-shift refunds counted when in scope).
  **B3** cancelled orders excluded from Cashier / Shift Sales / Payment Report. **B4** dashboard
  label fixed. **B6** refunds attributed by `approvedAt`. **B7** explicit tenant predicate in
  `computeRefundRevenue`. **B8** refund/net label hints.
- **No formula change** to the canonical revenue engine or the drawer reconciliation; **no API/DTO
  change**; **no new engine/endpoint/migration**.
- **Verified:** tsc 0, build 0, diff-check 0, runtime **14/14 PASS**, DB counts identical,
  `ORD-20260908-HCOK1L` untouched. Only the Payment Report number changed (cancelled excluded).
- **STOP.** No commit / push / deploy.
