# PHASE 8 — Finance / Revenue Consistency Audit

**Type:** AUDIT ONLY. No source change, no migration, no DB write, no historical repair, no
commit/push/deploy.
**Sources of truth:** `PHASE7-REFUND-CANCELLATION-AUDIT.md`, `PHASE7B-REFUND-CANCELLATION-HARDENING-REPORT.md`,
the existing Sales Report / Dashboard / Cashier Sales / Payment / Refund implementations.
**Method:** static reading of the finance surfaces + read-only SQL evidence against the local DB
(restaurant A = `cmtois12y0000bzu8o894azsd`).

---

## 1. Executive Summary

The platform already has **one canonical revenue engine** (`revenueWhere` + `computeRefundRevenue`
in `src/services/report/report.service.ts`) that is reused by the Sales Report, Dashboard
`todayRevenue`, Product / Profitability / Multi-Outlet reports. That engine is internally correct:
cancelled / failed / expired / unpaid are excluded, partial refunds are proportional, full refunds
net to 0.

**However, "Cashier Sales" is a separate engine** (`src/services/cashier-sales/cashier-sales.service.ts`)
that does **not** use it and computes a *different* number for the *same words*:

```
totalSales = Σ Payment.amount   (status = PAID, shift-linked)
netSales   = totalSales − Σ Refund.amount (status = APPROVED, shift-linked, requestedAt-dated)
```

vs the canonical report:

```
totalSales = Σ Order.grandTotal  (status ≠ CANCELLED, PAID or collected-then-refunded)
netSales   = Σ (grandTotal − tax − serviceCharge) − Σ proportional refund revenue
```

Result: **Cashier Sales and Sales Report / Dashboard can legitimately show different "sales" and
"net sales" for the same period.** The differences are a mix of *intentional* drawer/shift scoping
and *unintentional* formula/link bugs (refund attribution by shift, missing `order.status` filter,
gross-not-net dashboard card).

**Verdict: WARN** (no data loss, no security hole) with **one BLOCKER** for the stated goal
("cashier/report/dashboard must agree or be explicitly justified"): Cashier Sales `netSales` is a
**P2 bug** (mislabeled formula + refund shift-linking) and Cashier Sales can, in a latent case,
count a **CANCELLED order as a sale** (P1 latent). A focused **PHASE 8B** implementation is
recommended but not urgent.

**RQ (canonical basis):** `revenueWhere` (gross) + `computeRefundRevenue` (net). Everything else
should either adopt it or be explicitly documented as a non-revenue drawer ledger.

---

## 2. Existing Finance Architecture

```
Payment engine (payment.service.ts)              Refund/Cancellation engine (approval.service.ts)
  order.grandTotal → payment.amount                decideRefund: payment PAID→REFUNDED (full),
  order.paymentStatus ∈ {UNPAID,PENDING,PAID,       order.paymentStatus = netPaid>ε ? PAID : UNPAID
    FAILED,EXPIRED,REFUNDED,CANCELLED}             decideCancellation: order → CANCELLED,
  webhook CAS mirror                               live UNPAID/PENDING payments → FAILED
        │                                                   │
        └───────────────┬───────────────────────────────────┘
                        ▼
        report/report.service.ts  ← THE canonical revenue engine
          revenueWhere()          gross: Σ order.grandTotal over revenue set
          revenueScopeWhere()     date-free revenue scope (refund attribution)
          computeRefundRevenue()  net: Σ productRevenue − proportional refundRevenue
                        │
        ┌───────────────┼───────────────────────────────┬──────────────────────┐
        ▼               ▼                               ▼                      ▼
   Sales Report     Dashboard todayRevenue        Product/Profitability/   Cashier Sales
   (totalSales,     (getDashboardStats)           Multi-Outlet (reuse       (SEPARATE ENGINE,
    netSales)        = revenueWhere gross          computeRefundRevenue)     NOT canonical)
```

Revenue surfaces enumerated (`grep`):

| Surface | Service / function | Revenue basis |
|---|---|---|
| Sales Report | `report/report.service.ts` `getSalesReport` | `revenueWhere` (gross) + `computeRefundRevenue` (net) |
| Dashboard card | `order/order.service.ts` `getDashboardStats` | `revenueWhere` (gross) |
| Product report | `report/report.service.ts` `getProductReport` (1534) | `revenueWhere` |
| Shift Sales report | `report/report.service.ts` `getShiftSalesReport` (1722) | **Payment.amount, shift-linked** |
| Payment report | `report/report.service.ts` `getPaymentReport` (1865) | **Payment.amount (PAID), payment.createdAt** |
| Profitability | `profitability/profitability.service.ts` (349) | `computeRefundRevenue` |
| Multi-Outlet | `report/report.service.ts` `getMultiOutletReport` (2273) | `computeRefundRevenue` |
| Cashier Sales | `cashier-sales/cashier-sales.service.ts` `getCashierSales` | **Payment.amount, shift-linked + naive refund** |
| Shift reconciliation | `shift/shift.service.ts` | openingCash + cashSales − refunds |

---

## 3. Cashier Sales Audit

**Existing functionality** — `getCashierSales(restaurantId, filters, { userId, branchFilters })`
in `src/services/cashier-sales/cashier-sales.service.ts`; route `GET /api/cashier/sales`
(`src/app/api/cashier/sales/route.ts`) with `requireRoles(["ADMIN","CASHIER"])`, KASIR userId forced
server-side, branch scope via `authorizedBranches`/`assertBranchInScope`. UI
`src/app/admin/cashier/sales/page.tsx` renders `totalSales`, `totalCash`, `totalQris`,
`totalRefund`, `netSales`.

**Scoping:** shifts = `cashierShift.findMany({ restaurantId, branchId ∈ scope, userId, openedAt ∈ [start,end], id })`.
Payments = `{ restaurantId, shiftId ∈ shiftIds, method?, order.orderType? }`; transactions grouped
by `orderId`; `amount = order.grandTotal` in the ledger rows.

**Summary formulas (exact):**

```ts
salesWhere  = { ...contextWhere, status: "PAID" }          // contextWhere = restaurantId + shiftId∈ + method/orderType
refundWhere = { restaurantId, shiftId: { in: shiftIds }, status: "APPROVED",
                payment.method?, order.orderType?, requestedAt ∈ [start,end] }
totalSales  = Σ payment.amount (salesWhere)                 // line 353
totalRefund = Σ refund.amount  (refundWhere)                // line 352
netSales    = round2(totalSales - totalRefund)              // line 354
```

**Gaps:**
- **G1 — `netSales` is a different formula from the canonical `netSales`.** Cashier subtracts the
  **raw refunded amount** (which includes tax + service charge) from a **payment-amount** base;
  the report subtracts the **proportional product-revenue** share. Numbers differ whenever tax /
  service charge exist or a refund is partial.
- **G2 — refund shift-linking.** `refundWhere` requires `refund.shiftId ∈ shiftIds`. A refund whose
  `shiftId` is NULL (all online/QRIS refunds and legacy admin refunds) is **never counted**, so
  Cashier Sales reports the refund as **0** while the report subtracts it. *Evidence: the only
  APPROVED refund has `shiftId = null`.*
- **G3 — no `order.status` filter.** `salesWhere` counts by **payment status only**, unlike
  `revenueWhere` which requires `order.status ≠ CANCELLED`. A shift-linked PAID payment on a
  CANCELLED order would be booked as a sale. *Currently latent (the one CANCELLED+PAID order's
  payment has `shiftId = null`), but a real divergence once a shift-linked payment is cancelled.*
- **G4 — date basis is `shift.openedAt`, not the payment date.** A payment taken after midnight in
  a shift opened the previous day is attributed to the previous day; the report uses
  `order.createdAt` and the Payment Report uses `payment.createdAt`.
- **G5 — refund date basis is `refund.requestedAt`**, while the report uses `refund.approvedAt`.

**Root cause:** Cashier Sales was built as a **drawer/shift ledger** (correct for cash
reconciliation) but its output fields were named and displayed as *revenue* (`totalSales`,
`netSales`) without adopting the revenue engine.

---

## 4. Sales Report Audit

`report/report.service.ts` `getSalesReport` (1017):

- `soldWhere = revenueWhere(restaurantId, range, branchFilters, filters)` → activity/revenue set.
- `totalSales = Σ order.grandTotal`; `grossSales = Σ order.subtotal`; `totalDiscount/totalTax/totalServiceCharge`;
  `totalRefund = Σ refund.amount APPROVED (approvedAt ∈ range)` (raw, for display);
  `averageOrderValue = totalSales / paidCount`.
- `netSales = computeRefundRevenue(...).total.netSales` = `Σ (grandTotal − tax − serviceCharge) − Σ proportional refundRevenue`.
- `dailySeries` sums `grandTotal` over the revenue set → Σ series = `totalSales`.
- `totalRefund` (raw) and `refundReversal` (= `totalRefund`) are **display** values; they are **not**
  the refund actually subtracted from `netSales` (which is proportional). This is documented in code
  but is a **labeling trap** (P3).

**Verdict:** internally consistent and the canonical engine. No formula bug found. The only
concern is that the Report exposes **two different refund numbers** (`totalRefund` raw vs the
implicit proportional in `netSales`) without distinguishing them in the UI (`reports/page.tsx`
shows "Total Refund" = raw and "Net Sales" = proportional).

---

## 5. Dashboard Audit

`order/order.service.ts` `getDashboardStats` (1961) — route `GET /api/orders/dashboard/stats`.

- `todayRevenue = Σ order.grandTotal` over `revenueWhere(restaurantId, resolveReportRange("today"), branchFilters)`.
- Card label: **"Pendapatan Hari Ini"** (`src/app/admin/dashboard/page.tsx:204`).

**Consequence:** dashboard "revenue" = report **`totalSales` (GROSS)**, not `netSales`:
- a **partially** refunded order contributes its **full** `grandTotal` (no refund subtraction);
- a **fully** refunded order STAYS in the revenue set (via `payments.some(REFUNDED)`) and
  contributes its **full** `grandTotal`;
- tax + service charge are included.

This is **intentional** (PHASE 5B explicitly tied `todayRevenue` to `summary.totalSales`), and it is
**internally consistent with the Report's `totalSales`**. But the label "Pendapatan" implies net →
a **semantic/label gap (P2)** because refunds are not reflected on the dashboard.

Also note the dashboard does **not** scope payments by `payment.status` consistently: `paidOrders`
counts `payment.status = PAID` while `todayRevenue` is order-based; the two can disagree for
refunded orders (an order can be in the revenue set with 0 PAID payments). Minor (P3).

---

## 6. Payment Engine Audit

`payment.service.ts`:
- Payment `amount` is **always** `order.grandTotal` (server-recomputed; never client). Manual cash
  and QRIS intent both use `order.grandTotal`. **Evidence:** no PAID payment whose `amount` differs
  from its order `grandTotal` (`PAID_AMOUNT_VS_GRANDTOTAL_MISMATCHES = []`).
- Cashier payment sets the chosen `payment` row → `PAID` and `order.paymentStatus → PAID`
  (guarded `where: { paymentStatus: { not: "PAID" } }`).
- QRIS intent: creates PENDING payment, sets `order.paymentStatus = PENDING`; webhook CAS mirrors
  `payment.status` → `order.paymentStatus` **only while the order still reflects it**.
- **`shiftId` is only set for KASIR payments** (drawer). QRIS/VA payments and legacy admin entries
  have `shiftId = null`. **Evidence:** PAID payments with `shiftId` = 11 rows / Rp429.000; PAID with
  `shiftId = null` = 5 rows / Rp148.000.

**Relevance:** because Cashier Sales keys everything off `shiftId`, **QRIS (and admin) revenue is
structurally invisible to Cashier Sales** — the single largest source of divergence.

No payment-engine bug found for this audit (amount is always grandTotal).

---

## 7. Refund Engine Audit

`approval.service.ts` `decideRefund` (352) on approve:
- writes one immutable `PaymentTransaction { type:"refund", status:"REFUNDED", amount:-amount }`;
- **full refund** (`netPaid ≤ ε`): all `PAID` payments → **REFUNDED**; `order.paymentStatus → UNPAID`;
- **partial refund**: payments stay `PAID`; `order.paymentStatus → PAID`;
- over-refund guard: `requestRefund` caps at `collected − approved`; cumulative over-refund blocked.

`computeNetCollected` (PHASE 7B) is the single "money still held" basis.

**Refund `shiftId`** = the drawer of the collected KASIR payment (`payment.shiftId`) or the
requester's open shift, else **null**. **Evidence:** the only APPROVED refund has `shiftId = null`
(QRIS/legacy), which is exactly why Cashier Sales misses it (G2).

No refund-engine bug found; the engine is the source of truth for refund state. The **mismatch is
purely in the Cashier Sales *reader*** (G1/G2/G5).

---

## 8. Revenue Formula Comparison

| Concept | Sales Report / Dashboard (canonical) | Cashier Sales | Payment Report | Shift Sales |
|---|---|---|---|---|
| "Sales" base | Σ `Order.grandTotal` (revenue set) | Σ `Payment.amount` (PAID, shift-linked) | Σ `Payment.amount` (PAID, payment date) | Σ `Payment.amount` (PAID, shift-linked) |
| Cancelled excluded? | **Yes** (`status ≠ CANCELLED`) | **No** (payment-status only) ⚠️ | **No** ⚠️ | **No** ⚠️ |
| Failed/expired excluded? | Yes (not PAID) | Yes (default PAID) | Yes (default PAID) | Yes |
| Refund basis | proportional product-revenue (capped) | raw `refund.amount`, shift-linked | — | raw `refund.amount`, shift-linked |
| Refund date | `refund.approvedAt` | `refund.requestedAt` | — | (all-time per shift) |
| Date basis (sales) | `order.createdAt` | `shift.openedAt` | `payment.createdAt` | `shift.openedAt` |
| Net label | `netSales` (product basis) | `netSales = sales − refund` | — | cash drawer |

**A — Canonical revenue basis:** `revenueWhere` (gross) + `computeRefundRevenue` (net), both in
`report/report.service.ts`. This is the source of truth used by the Sales Report, Dashboard,
Product, Profitability and Multi-Outlet surfaces.

**B — Different formulas:** `cashier-sales/cashier-sales.service.ts` (`getCashierSales`),
`report/report.service.ts` `getShiftSalesReport`, `getPaymentReport`.

**C — Intentional vs bug:**
- *Intentional:* shift/drawer scoping in Cashier/Shift Sales (needed for cash reconciliation);
  the Payment Report being a payment-row ledger.
- *Bug / indefensible:* Cashier Sales `netSales` formula (G1), refund shift-linking under-count
  (G2), missing `order.status` filter (G3), refund `requestedAt` vs `approvedAt` (G5).
- *Semantic gap:* Dashboard card labeled "Pendapatan" that is gross, not net (P2).

**D — Can numbers differ?** **Yes, materially** (see §9/§10/§21).

---

## 9. Gross Revenue

- Canonical **gross** (`totalSales`/`grossRevenue`) = Σ `order.grandTotal` over the revenue set
  (cancelled excluded; PAID or collected-then-refunded). Includes tax + service charge.
- Cashier Sales `totalSales` = Σ `payment.amount` over shift-linked PAID only.
- **Diverges by construction**: different unit (payment vs order), different inclusion
  (shift-linked vs order-based), different cancellation policy.

## 10. Net Revenue

- Canonical `netSales` = `Σ productRevenue − Σ proportional refundRevenue`, `productRevenue =
  grandTotal − tax − serviceCharge`; a full refund yields exactly **0** (never negative).
- Cashier `netSales` = `Σ payment.amount − Σ raw refund.amount` = **naive**; can be **negative**
  when a shift-linked full refund's sales row is absent (payment now REFUNDED, not PAID) or when
  multiple refunds exceed the shift's PAID amount. The PHASE 5 H3 patch explicitly rejected this
  naive formula for the report.
- Dashboard `todayRevenue` = **gross**, no refund subtraction.

## 11. Refund Semantics

APPROVED refunds only. Full → payments REFUNDED + order UNPAID; partial → payments stay PAID +
order PAID. Report attributes refunds by `approvedAt` and applies them on the product-revenue basis
(capped, cumulative). Cashier Sales attributes by `requestedAt` and requires `refund.shiftId ∈
scope`. `Refund.amount` is server-validated ≤ collected − approved (over-refund blocked).

## 12. Cancellation Semantics

`decideCancellation` (engine A) and the PHASE 7B-guarded direct path both set `order.status =
CANCELLED`; the direct path now refuses while collected money is held. **All revenue engines except
the shift/payment/cashier ledgers exclude `order.status = CANCELLED`.** Cashier/Shift/Payment
ledgers filter on payment status only → they *could* surface a collected payment on a cancelled
order. **Evidence:** `ORD-20260908-HCOK1L` is `CANCELLED + PAID` (QRIS Rp90.000, `shiftId = null`);
it is correctly excluded from `revenueWhere` and currently excluded from Cashier Sales only because
its payment is not shift-linked.

## 13. Payment Status Semantics

`UNPAID/PENDING` → never revenue. `PAID` → revenue. `FAILED/EXPIRED/CANCELLED` → never revenue.
`REFUNDED` → collected (counts in `COLLECTED_PAYMENT_STATUSES`); a `REFUNDED` payment keeps the
order in the revenue set via `payments.some(REFUNDED)` so revenue is **reversed**, not dropped.
Cashier Sales/Shift/Payment ledgers treat `PAID` as the only sales bucket (correct) but **do not**
consult `order.status` (G3).

## 14. Cash vs QRIS

- Cash (KASIR) payments carry `shiftId` → visible to Cashier/Shift Sales.
- QRIS payments carry `shiftId = null` → **invisible to Cashier/Shift Sales**; visible to the
  report/dashboard (order-based) and to the Payment Report (`payment.createdAt`, no shift needed).
- **Evidence:** Cashier Sales would omit the QRIS portion entirely for the shift scope. This is
  the single biggest real-world divergence.

## 15. Partial Refund

- Canonical: order stays PAID, payment stays PAID → in revenue set at full `grandTotal`; netSales
  subtracts `refunded/grandTotal × productRevenue`.
- Cashier: payment counted full; refund counted **only if shift-linked** and by `requestedAt`.
- **Divergence:** report nets it proportionally; Cashier uses raw amount; Dashboard does not net it.

## 16. Full Refund

- Engine: payments → REFUNDED, order.paymentStatus → UNPAID.
- Canonical: the order **stays** in the revenue set (`payments.some(REFUNDED)`), so `totalSales`
  still counts full `grandTotal`, and `netSales` subtracts the proportional refund → **0**.
- **Dashboard `todayRevenue` still counts the full `grandTotal`** → today's dashboard can show
  revenue for an order that was fully refunded. **P2.**
- Cashier: payment is no longer PAID → excluded from `totalSales`; the refund is added only if
  shift-linked → `netSales` can be **negative** or the refund can be dropped.

## 17. Multiple Refund

- Engine: cumulative guard blocks over-refund; each approval is separate.
- Canonical `computeRefundRevenue` aggregates all APPROVED refunds per order and caps at
  `productRevenue` via `LEAST(refunded/grandTotal, 1)` → netSales never negative.
- Cashier sums raw APPROVED refunds shift-linked, **no cap** → netSales can go negative.

## 18. Tenant Isolation

All four readers scope by `restaurantId` from the session/argument: `getCashierSales`
(`shiftWhere.restaurantId` + `payment.restaurantId`), `getSalesReport` (`revenueWhere`),
`getDashboardStats`, `getPaymentReport`. `computeRefundRevenue`'s refund subquery has **no explicit
`restaurantId`** but is joined to `order o` filtered by `o.restaurantId`, and `orderId` is globally
unique → no cross-tenant leak (a **defense-in-depth/performance** note, P3). **Verdict: OK.**

## 19. Branch Isolation

- Report/Dashboard: `order.branchId ∈ branchFilters`; refund scope `order.branchId ∈` via
  `revenueScopeWhere` + `refund.branchId ∈ branchFilters`.
- Cashier Sales: `shift.branchId ∈ branchFilters`; refund scope `refund.shiftId ∈ shifts` (whose
  branch is in scope) — **not** `refund.branchId`.
- **Consequence:** branch filtering uses different keys (`order.branchId` vs `shift.branchId` vs
  `refund.branchId`). A refund whose `shiftId` is null is unreachable in Cashier Sales regardless of
  branch; a payment whose `shiftId` is null is invisible even for the correct branch. **P2.**

## 20. Date Range Semantics

Four date bases for the "same" period:

| Reader | Sales date field | Refund date field |
|---|---|---|
| Sales Report / Dashboard | `order.createdAt` | `refund.approvedAt` |
| Cashier Sales | `shift.openedAt` | `refund.requestedAt` |
| Payment Report | `payment.createdAt` | — |
| Shift Sales | `shift.openedAt` | (per shift) |

`resolveReportRange` (`today/yesterday/week/month/custom`) is shared by Report/Dashboard only.
Cashier Sales builds its own date bounds and applies them to **shifts**, so a cross-midnight shift
misattributes revenue. **P2.**

## 21. Runtime / Data Evidence (read-only, restaurant A)

Payments by method/status:

```
KASIR UNPAID    11 / 319000      QRIS PENDING   3 / 115000
KASIR PAID       9 / 435000      QRIS PAID      7 / 142000
KASIR REFUNDED   1 /  30000      QRIS EXPIRED   4 / 149500
KASIR CANCELLED  7 / 166000      QRIS CANCELLED 4 / 120000
```

- PAID payments total **16 rows / Rp577.000**; with `shiftId` = **11 / Rp429.000**;
  `shiftId = null` = **5 / Rp148.000** → Cashier Sales excludes Rp148.000 of real QRIS revenue.
- Orders by status/paymentStatus: `COMPLETED/PAID` = 13 / Rp404.000; `CANCELLED/PAID` = **1 /
  Rp90.000**; `COMPLETED/UNPAID` = 1 / Rp30.000 (the fully refunded order).
- `revenueWhere` set = **16 orders / grossRevenue Rp517.000 / productRevenue Rp517.000**;
  approved refunds = Rp30.000 → report `netSales ≈ Rp487.000` (product basis).
- Cashier Sales basis = shift-linked only → **excludes** the 5 null-shift PAID payments (Rp148.000),
  and `totalRefund = 0` because the **only APPROVED refund has `shiftId = null`**.
- The one CANCELLED+PAID order is `ORD-20260908-HCOK1L` (QRIS Rp90.000, `shiftId = null`) — excluded
  from `revenueWhere` (correct); currently excluded from Cashier Sales only by the null shift.
- `PAID_AMOUNT_VS_GRANDTOTAL_MISMATCHES = []` → payment.amount always equals order.grandTotal in the
  current data, so the "unit" divergence is structural, not yet numerically visible except via
  shift-linking.
- No order has more than one PAID payment (`ORDERS_WITH_MULTI_PAID_PAYMENTS = []`).

**Net:** for the **same all-time period**, canonical report and Cashier Sales already **cannot**
agree because Cashier excludes all non-shift-linked QRIS and all null-shift refunds.

## 22. Bugs Found

| # | Bug | Severity |
|---|---|---|
| B1 | Cashier Sales `netSales = totalSales − rawRefund` uses a different (naive) formula than the canonical `netSales`; can go negative | P2 |
| B2 | Cashier Sales `refundWhere` requires `refund.shiftId ∈ shifts` → null-shift (QRIS/legacy) refunds are **never** counted (evidence: the only APPROVED refund is missed) | P1 |
| B3 | Cashier/Shift/Payment ledgers have **no `order.status` filter** → a shift-linked PAID payment on a CANCELLED order is booked as a sale (latent; current data not triggered) | P1 latent |
| B4 | Dashboard "Pendapatan Hari Ini" is **gross** (no refund subtraction) though labeled revenue | P2 |
| B5 | Four different date bases for the same period (`shift.openedAt` / `payment.createdAt` / `order.createdAt` / `refund.approvedAt`) | P2 |
| B6 | Cashier Sales refund date uses `refund.requestedAt` vs report `refund.approvedAt` | P3 |
| B7 | `computeRefundRevenue` refund subquery lacks explicit `restaurantId` (safe via join; defense-in-depth/perf) | P3 |
| B8 | Report exposes raw `totalRefund` and proportional `netSales` refund without UI distinction | P3 |

### 22.1 Finding Detail — B1 (Cashier `netSales` formula)
- **Existing functionality:** Cashier Sales summary card "Net Sales" (`src/app/admin/cashier/sales/page.tsx:313`).
- **Gap:** a different `netSales` formula than the canonical report; can go negative.
- **Root cause:** naive subtraction of the raw refund total from a payment-amount sales base.
- **Exact file:** `src/services/cashier-sales/cashier-sales.service.ts`
- **Exact function:** `getCashierSales()` (return block, line ~354)
- **Current formula:** `netSales = round2(Σ Payment.amount(status=PAID, shift-linked) − Σ Refund.amount(status=APPROVED, shift-linked, requestedAt∈range))`
- **Expected formula:** canonical `computeRefundRevenue(scope).total.netSales` = `Σ(grandTotal − tax − serviceCharge) − Σ proportional refundRevenue` (capped), or explicit renaming.
- **Severity:** P2
- **Recommended minimal fix:** option (a) reuse `computeRefundRevenue` for the same order scope, or (b) rename the field to `netCollected` and surface the report's canonical `netSales` separately.

### 22.2 Finding Detail — B2 (refund shift-linking under-count)
- **Existing functionality:** refunds reduce revenue through `totalRefund`.
- **Gap:** refunds with `shiftId = null` (QRIS/legacy) are never counted.
- **Root cause:** `refundWhere` scopes refunds by the shift (drawer), not by the visible order set.
- **Exact file:** `src/services/cashier-sales/cashier-sales.service.ts`
- **Exact function:** `getCashierSales()` (`const refundWhere`, line ~296)
- **Current formula:** `Where: { restaurantId, shiftId: { in: shiftIds }, status: "APPROVED", requestedAt∈range }`
- **Expected formula:** refund scope keyed off the visible orders (`orderId: { in: visibleOrderIds }`) and/or `refund.branchId ∈ branchFilters`.
- **Severity:** P1
- **Recommended minimal fix:** replace the shift predicate with an order-scope predicate (keep the shift join only for drawer totals).

### 22.3 Finding Detail — B3 (no `order.status` filter in ledgers)
- **Existing functionality:** the ledgers count sales by `payment.status`.
- **Gap:** a shift-linked PAID payment on a CANCELLED order would be booked as a sale.
- **Root cause:** the query omits `order.status ≠ CANCELLED` (the canonical `revenueWhere` has it).
- **Exact files:** `src/services/cashier-sales/cashier-sales.service.ts`; `src/services/report/report.service.ts`
- **Exact functions:** `getCashierSales()`; `getShiftSalesReport()` (1722); `getPaymentReport()` (1865)
- **Current formula:** `where = { restaurantId, shiftId∈shiftIds, status: "PAID" }`
- **Expected formula:** add `order: { status: { not: "CANCELLED" } }`.
- **Severity:** P1 (latent — not triggered by current data)
- **Recommended minimal fix:** add the `order.status` predicate to all three ledgers.

### 22.4 Finding Detail — B4 (dashboard "Pendapatan" is gross)
- **Existing functionality:** Dashboard card "Pendapatan Hari Ini" (`src/app/admin/dashboard/page.tsx:204`).
- **Gap:** shows gross revenue with no refund subtraction (label implies net).
- **Root cause:** `todayRevenue` aggregates `order.grandTotal` over `revenueWhere`, which keeps refunded orders at full value.
- **Exact file:** `src/services/order/order.service.ts`
- **Exact function:** `getDashboardStats()` (line ~2025)
- **Current formula:** `todayRevenue = Σ order.grandTotal` over `revenueWhere(restaurantId, resolveReportRange("today"), branchFilters)`
- **Expected formula:** either relabel ("Penjualan Bruto Hari Ini") or use `computeRefundRevenue(...).total.netSales` for "today".
- **Severity:** P2
- **Recommended minimal fix:** relabel the card, or switch the card to `netSales` (product decision).

### 22.5 Finding Detail — B5 (four date bases)
- **Existing functionality:** date/period filters on every revenue surface.
- **Gap:** the "same" period selects different rows in different readers.
- **Root cause:** each reader chooses its own date field.
- **Exact files:** `src/services/report/report.service.ts`, `src/services/order/order.service.ts`, `src/services/cashier-sales/cashier-sales.service.ts`
- **Exact functions:** `getSalesReport()` / `getDashboardStats()` (`order.createdAt`, `refund.approvedAt`); `getCashierSales()` (`shift.openedAt`, `refund.requestedAt`); `getPaymentReport()` (`payment.createdAt`)
- **Current formula:** mixed `order.createdAt` / `shift.openedAt` / `payment.createdAt` / `refund.approvedAt` / `refund.requestedAt`
- **Expected formula:** one documented basis (order date for revenue; refund `approvedAt`; ledger date = `payment.createdAt` or explicit shift basis)
- **Severity:** P2
- **Recommended minimal fix:** align the Cashier/Payment ledger date filters to `payment.createdAt` (or document the shift basis explicitly).

### 22.6 Finding Detail — B6 (refund date basis)
- **Existing functionality:** Cashier Sales refund total by period.
- **Gap:** attributed by `requestedAt`, not `approvedAt` (differs from the report).
- **Root cause:** `refundWhere.requestedAt`.
- **Exact file:** `src/services/cashier-sales/cashier-sales.service.ts`
- **Exact function:** `getCashierSales()` (`refundWhere`)
- **Current formula:** `requestedAt: { gte, lte }`
- **Expected formula:** `approvedAt: { gte, lte }`
- **Severity:** P3
- **Recommended minimal fix:** switch the field to `approvedAt`.

### 22.7 Finding Detail — B7 (`computeRefundRevenue` subquery tenancy)
- **Existing functionality:** canonical net revenue across Report/Profitability/Multi-Outlet.
- **Gap:** the inner refund scan has no explicit tenant predicate.
- **Root cause:** tenancy is enforced only by the `JOIN order o ON o.id = rf.orderId` + `o.restaurantId`.
- **Exact file:** `src/services/report/report.service.ts`
- **Exact function:** `computeRefundRevenue()`
- **Current formula:** `FROM refund r WHERE r.status='APPROVED' AND r.approvedAt∈range GROUP BY r.orderId` (unscoped)
- **Expected formula:** add `AND r.restaurantId = scope.restaurantId`.
- **Severity:** P3 (no leak today; defense-in-depth/perf)
- **Recommended minimal fix:** add `r.restaurantId` to the subquery.

### 22.8 Finding Detail — B8 (raw vs proportional refund in Report)
- **Existing functionality:** Sales Report "Total Refund" and "Net Sales" cards (`src/app/admin/reports/page.tsx:209-211`).
- **Gap:** "Total Refund" is the raw `Σ refund.amount` while "Net Sales" subtracts the proportional product-revenue share; the two refund concepts are not distinguished in the UI.
- **Root cause:** `summary.totalRefund` (raw) and `netSales` (proportional) coexist.
- **Exact file:** `src/services/report/report.service.ts`
- **Exact function:** `getSalesReport()` (summary return, ~1400)
- **Current formula:** `totalRefund = Σ refund.amount(APPROVED, approvedAt∈range)`; `netSales` uses proportional `refundRevenue`
- **Expected formula:** keep both but label clearly (e.g. "Refund (bruto)" vs the net effect shown inside `netSales`).
- **Severity:** P3
- **Recommended minimal fix:** add a hint/label distinguishing raw refund from the net effect.

## 23. Severity Classification

- **P0 / BLOCKER:** none (no data loss, no cross-tenant leak, no wrong money at rest).
- **P1 (should fix, real divergence):** B2 (refund under-count), B3 (cancelled-order leak, latent).
- **P2 (should fix, correctness/label):** B1, B4, B5.
- **P3 (nice-to-have):** B6, B7, B8.
- **Goal-level BLOCKER:** the user's requirement "Cashier / Report / Dashboard must be consistent or
  explicitly justified" is **not yet met** — Cashier Sales is neither canonical nor documented as a
  pure drawer ledger. **PHASE 8B recommended.**

## 24. Recommended Fix (minimal, no new engine)

Preferred approach — **make Cashier Sales reuse the canonical semantics or be explicitly scoped**:

1. **G1/B1:** Replace `netSales = totalSales − totalRefund` with the canonical product-revenue
   basis. Two options:
   - (a) *Minimal/consistent:* compute `netSales` from the **same order scope** as the report for
     the filtered window (reuse `computeRefundRevenue` with a shift/order scope), **or**
   - (b) *Documented drawer ledger:* rename the Cashier Sales fields to non-revenue names
     (`collectedAmount`, `drawerRefund`, `netCollected`) and show the canonical `netSales` from the
     report in a separate card. (Least code, no formula invention.)
2. **G2/B2:** Stop keying refunds off `refund.shiftId`. Scope refunds by
   `refund.order ∈ (orders visible in the current cashier/branch/date scope)` (and keep the shift
   join only for *drawer* totals). This makes QRIS/legacy refunds visible.
3. **G3/B3:** Add `order: { status: { not: "CANCELLED" } }` to `salesWhere` (and to the Shift/Payment
   reports) so the ledgers exclude cancelled orders exactly like `revenueWhere`.
4. **G5/B6:** Attribute refunds by `approvedAt` consistently.
5. **B4:** Either relabel the dashboard card ("Penjualan Bruto Hari Ini") or make it show
   `netSales`; do **not** leave "Pendapatan" labeling a gross figure. (Product decision.)
6. **B7:** Add `AND r.restaurantId = <id>` to the `computeRefundRevenue` refund subquery.
7. **B5/B8:** Document the four date bases and the raw-vs-proportional refund distinction in the UI.

**Do NOT** create a new finance engine, new endpoint, migration, or change the payment/refund
engines.

## 25. Files That Would Need Changes (for 8B, not done now)

| File | Change |
|---|---|
| `src/services/cashier-sales/cashier-sales.service.ts` | refund scope, `order.status` filter, `netSales` basis/renaming, `approvedAt` |
| `src/services/report/report.service.ts` | add `restaurantId` to `computeRefundRevenue` refund subquery; optional `netSales` for shift scope |
| `src/services/order/order.service.ts` | dashboard card basis/label (if B4 is fixed) |
| `src/app/admin/cashier/sales/page.tsx`, `src/app/admin/dashboard/page.tsx`, `src/app/admin/reports/page.tsx` | labels/cards (if renamed) |
| Possible `src/services/shift/shift.service.ts` | drawer refund basis (only if reconciled) |

No Prisma schema file is in this list.

## 26. Database Impact

**None.** This phase is read-only. The recommended 8B changes are **query/filter changes** only —
no DDL, no DML, no backfill.

## 27. Migration Required?

**No.** No schema change, no data migration, no historical repair. The fixes are in
service queries and UI labels.

## 28. Security Impact

- **Positive:** no new auth surface; all readers keep session-scoped `restaurantId` and branch
  scoping (`requireRoles`, `authorizedBranches`, `assertBranchInScope`). Fixing B3 (cancel filter)
  *strengthens* correctness; adding `restaurantId` to `computeRefundRevenue` (B7) is
  defense-in-depth.
- **No** client-trusted amount/status is introduced anywhere.
- The audited divergence is a **reporting** issue, not an authorization or tenant-isolation issue.

## 29. Regression Risk

- **Low** for the recommended minimal fixes: they are additive filters (`order.status`,
  `restaurantId`) and a formula alignment. The biggest risk is **changing Cashier Sales numbers**
  that staff may rely on for drawer reconciliation — so option (b) "rename/document rather than
  recompute" is safest.
- Reusing `revenueWhere`/`computeRefundRevenue` avoids a new formula and keeps the Sales
  Report / Dashboard / Profitability numbers unchanged.
- Must re-verify: Sales Report, Dashboard, Payment Report, Shift Sales, Profitability, Multi-Outlet
  after any 8B change (they share `revenueWhere`).

## 30. Implementation Plan (PHASE 8B, awaiting approval)

1. Decide B1 approach: **(b) relabel/rename** Cashier Sales fields as drawer-collected (safest) vs
   **(a) reuse `computeRefundRevenue`** (numbers change). — *product decision*
2. Decide B4: relabel the dashboard card vs switch to `netSales`. — *product decision*
3. Implement B2 (refund scope by order, not shift), B3 (`order.status ≠ CANCELLED` in
   Cashier/Shift/Payment ledgers), B6 (`approvedAt`), B7 (`restaurantId` in `computeRefundRevenue`).
4. Add a consistency test asserting `report.netSales` and the (aligned or renamed) Cashier figure
   agree for a fixed fixture, incl. partial/full/multiple refunds and a cancelled+paid order.
5. Runtime-verify the edge-case matrix (UNPAID / PAID CASH / PAID QRIS / CANCELLED±PAID / partial /
   full / multiple refund / FAILED / EXPIRED / branch-scoped / tenant / today / custom range).
6. No migration, no schema change, no historical repair.

---

## Final Verdict

| Item | Result |
|---|---|
| Canonical revenue engine exists and is correct | **PASS** |
| Cashier Sales is consistent with the canonical engine | **FAIL** (different unit, refund scope, formula, date basis) |
| Report vs Dashboard consistency | **PASS** (`todayRevenue` = `totalSales` by design) but **WARN** (gross, not net) |
| Cancelled / failed / expired / unpaid excluded from canonical revenue | **PASS** |
| Cancelled excluded from Cashier/Shift/Payment ledgers | **FAIL** (no `order.status` filter — latent) |
| Refund reduces canonical revenue correctly (partial/full/multiple) | **PASS** |
| Refund reduces Cashier Sales revenue correctly | **WARN** (null-shift refunds dropped; naive formula) |
| Tenant isolation | **PASS** |
| Branch isolation | **WARN** (different keys per reader) |
| Date-range semantics | **WARN** (four different bases) |
| **Goal-level** | **BLOCKER** — cashier/report/dashboard not yet consistent or explicitly justified |

**PASS / FAIL / WARN / BLOCKER:** PASS (canonical engine, P0/P1 exclusion, tenant) · FAIL (Cashier
Sales consistency, ledger cancel filter) · WARN (dashboard gross label, refund scope/date, branch
keys) · **BLOCKER** (the stated consistency goal).

**Recommendation: PHASE 8B implementation IS needed**, but it is a **targeted consistency fix**, not
an emergency — no P0, no data loss, no security issue. Two product decisions (B1 approach, B4 label)
should be answered before coding. If "no numbers may change," choose the rename/document path.

**STOP after this audit.** No code, no migration, no DB write, no commit/push/deploy.
