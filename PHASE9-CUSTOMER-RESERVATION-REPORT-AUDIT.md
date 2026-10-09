# PHASE 9 — Customer & Reservation Report Audit

**Type:** AUDIT ONLY. No coding, no source change, no migration, no DB write, no seed, no
commit/push/deploy.
**Method:** static reading of the customer/reservation/report surfaces + **read-only** SQL evidence
against the local DB (restaurant A = `cmtois12y0000bzu8o894azsd`).

---

## 1. Executive Summary

- **Customer**: there is a working **customer list** (`/admin/customers`) with search, pagination,
  order count, raw spend and last order. There is **no** customer report/statistics page, no
  customer revenue/segmentation, no CRM metrics (new/returning/active/inactive/AOV), and no export.
  Its "totalSpent" uses a **raw `Σ order.grandTotal`** that includes CANCELLED orders and ignores
  refunds — **inconsistent with the canonical revenue semantics audited in PHASE 8/8B**.
- **Reservation**: there is a working **reservation list/detail + status workflow** (PENDING →
  CONFIRMED → SEATED → COMPLETED, plus CANCELLED/NO_SHOW) with tenant/branch scoping, and
  `ReservationView` already hydrates the **linked order + payment**. There is **no** reservation
  report/statistics, **no** reservation revenue aggregation, **no** funnel, and no export.
- **Report engine**: `src/services/report/report.service.ts` is the canonical report engine
  (sales/payments/products/profitability/multi-outlet/inventory/menu-engineering/purchases/
  shift-sales). It contains **no customer and no reservation report** — the natural home for both is
  a **small extension of this engine**, not new services.
- **Reuse**: export (`src/lib/csv.ts` + `/api/reports/*/export`), `revenueWhere`,
  `computeRefundRevenue`, `authorizedBranches`/`assertBranchInScope`, and `reservationViews` are all
  reusable.

**Verdict:** **WARN** — the *workflow* is complete, the *reporting* is largely **missing/partial**,
and there is **one real security finding** (customer password hash exposed in the customers API
response). No P0, no data loss. A focused **PHASE 9B** (reporting + one redaction) is recommended.

---

## 2. Existing Customer Report

| Capability | Status | Where |
|---|---|---|
| Customer list | **Exists** | `src/app/admin/customers/page.tsx` → `GET /api/customers` → `customerService.getCustomers` |
| Search (name/phone) | Exists | `getCustomers` `where.OR` |
| Pagination | Exists (server-side) | `getCustomers` |
| Order count | Exists (`_count.orders`) | `getCustomers` |
| Raw spend (`totalSpent`) | Exists (raw, not canonical) | `getCustomers` |
| Last order date | Exists (bounded) | `getCustomers` (`orders take:1`) |
| Customer detail | **Partial** | `GET /api/customers/[id]` → `getCustomer` (last 10 orders only) |
| Customer report / statistics page | **Missing** | — |
| Customer revenue (canonical) | **Missing** | — |
| Segmentation / acquisition / retention | **Missing** | — |
| Customer reservation history | **Missing** | — |
| Customer CSV export | **Missing** | — |

## 3. Existing Customer Statistics

None. There is no `/admin/reports/customers`, no `getCustomerStats`/`getCustomerReport` anywhere
(`grep -ri "customer" report.service.ts` → only incidental `customer.name` selections). The only
"statistics" are the per-row `orderCount` / `totalSpent` / `lastOrderAt` computed on the fly in
`getCustomers`.

**Computable today (data exists):** total customers, guest vs registered
(`phone like 'guest-%'`, `password/email` present), new vs returning (from `order.createdAt` /
`customer.createdAt`), active/inactive (last order recency), order count, AOV, gross/net spend.
**Not computable without new logic/field:** cohort retention over time (no snapshot), formal
segmentation labels.

## 4. Existing Customer Revenue

`getCustomers` computes, for the current page of customers:

```ts
prisma.order.groupBy({
  by: ["customerId"],
  where: { restaurantId, customerId: { in: ids }, ...(branchFilters ? { branchId: { in } } : {}) },
  _sum: { grandTotal: true },
})
```

**This is raw gross `Σ order.grandTotal`**: it includes **CANCELLED** orders, counts **UNPAID/
FAILED/EXPIRED** orders (they still have a grandTotal), and **never subtracts refunds**. It does
**not** use `revenueWhere`/`computeRefundRevenue` and therefore violates the PHASE 8/8B canonical
revenue semantics. Evidence (restaurant A): raw `Σ grandTotal = 1.138.700` vs non-cancelled
`= 905.700` → **Rp233.000 of cancelled-order money is currently shown as customer spend.**

## 5. Existing Customer Order Metrics

- `orderCount` = **all** orders for the customer (`_count.orders`), **not branch-filtered**.
- `totalSpent`/`lastOrderAt` = **branch-filtered** (`orders where branchId in branchFilters`).
- ⇒ For a branch-scoped caller, **`orderCount` and `totalSpent` use different scopes** (all-branch
  count vs branch-only spend) — an inconsistency, not merely a missing feature.
- No completed/paid/cancelled split, no item quantity, no AOV.

## 6. Existing Customer Reservation Metrics

**None.** `Customer` has no `reservations` relation; `Reservation.customerId` is a **scalar** (no
relation, though `@@index([customerId])` exists). Reservation history per customer is *queryable*
(`reservation.findMany({ where: { customerId, restaurantId } })`) but **not surfaced** anywhere in
the admin UI or any service method. `getCustomer` returns **only orders**.

## 7. Existing Reservation Report

| Capability | Status | Where |
|---|---|---|
| Reservation list (filters + pagination) | **Exists** | `src/app/admin/reservations/page.tsx` → `GET /api/admin/reservations` → `listReservations` |
| Reservation detail | Exists | `GET /api/admin/reservations/[id]` (tenant+branch scoped) |
| Status workflow (book/seat/complete/cancel/no-show) | Exists | `updateStatus`/`cancelReservation`/`transitionReservation` |
| Linked order + payment in the view | Exists | `reservationViews` (`order`, `payment`) |
| Reservation statistics | **Missing** | — |
| Reservation revenue | **Missing** | — |
| Reservation funnel / conversion | **Missing** | — |
| Reservation by customer / by table / by date aggregates | **Missing** | — |
| Reservation CSV export | **Missing** | — |

## 8. Existing Reservation Statistics

None. The reservations page has only a list and a total count (`total`, `totalPages`). No counts by
status, no cancellation/no-show rate, no party-size stats, no per-branch/per-date aggregation.
`grep` for `getReservationStats|reservationReport` → none.

**Computable today (data exists):** count by `status` (6 statuses), no-show rate
(`NO_SHOW / (CONFIRMED+SEATED+COMPLETED+NO_SHOW)`), cancellation rate (`CANCELLED / total`), party
size (`Σ partySize`, min/max/avg), by branch, by `reservationDate`, by table, by `source`
(PUBLIC/ADMIN). **Not computable:** time-ordered transition funnel and durations between states
(only aggregate timestamps `confirmedAt/seatedAt/completedAt/cancelledAt` exist — no history table).

## 9. Existing Reservation Revenue

No reservation revenue report exists. But the linkage needed for one **already exists**:

- `Reservation.orderId` (scalar) → the reservation's purchase is a real **Order** created by the
  existing order engine (`createReservationOrder` → `orderService.createCustomerOrderInTransaction`,
  reservation mode). The order has normal `OrderItem`s and `Payment`s.
- `reservationViews` already exposes `order.grandTotal`, `order.status`, `order.paymentStatus` and
  `payment` (derived from `Order.paymentStatus`).

So **reservation revenue can reuse the canonical engine** by scoping `revenueWhere` /
`computeRefundRevenue` to the order-id set of reservations in range. **Do not build a reservation
revenue engine.** Current data: 1 reservation, **0 with `orderId`** → no reservation revenue exists
yet to reconcile (the flow is built but unused in the test DB).

## 10. Reservation Funnel

No funnel exists. The data model supports a **static** funnel via `status` counts + the `*At`
timestamps:

```
Created (createdAt) → Confirmed (confirmedAt) → Paid (Order.paymentStatus) → Seated (seatedAt) → Completed (completedAt)
                                ↘ Cancelled (cancelledAt)   ↘ No-show (status)
```

- **Available:** per-status counts and the first-occurrence timestamps.
- **Gap:** there is **no `ReservationStatusHistory` table** (unlike `OrderStatusHistory`), so the
  funnel is *point-in-time by current status*, not a true transition path; a reservation that went
  PENDING→CONFIRMED→CANCELLED loses intermediate history. A time-ordered funnel / drop-off would
  need a history table (see §24) — **not required** for a basic status-count funnel.
- **OrderStatusHistory** exists for orders and could support the "paid/completed order" leg if a
  reservation's order is combined into reports, but it is on `Order`, not `Reservation`.

## 11. Reservation Payment

Reservation payment is **parsed, not duplicated**: `ReservationView.payment.status` is derived from
**`Order.paymentStatus`** (single source of truth), with method/amount/paidAt from the latest
payment intent. `Order.paymentStatus` ∈ canonical `PaymentStatus` enum. The public reservation flow
creates the order (and optional KASIR/QRIS intent) via the existing order/payment engines
(`reservationMode: true`). No reservation-level payment column/table exists (by design). So
"paid reservation" = reservation whose linked order is in the canonical revenue set — reusable.

Risk to decide (not a bug today): a reservation whose order is **CANCELLED** but was paid, or a
**refunded** reservation order — the report must classify with the same canonical rules, not the raw
`grandTotal`.

## 12. Cancellation / No-show

- Cancellation: `cancelReservation` → `transitionReservation` → only `PENDING`/`CONFIRMED` may be
  cancelled (matrix-enforced); `cancelledAt` + `cancelReason` set once.
- No-show: `CONFIRMED → NO_SHOW` only (`VALID_RESERVATION_TRANSITIONS`); no timestamp column for
  no-show (uses current `status`; `updatedAt` is the only time signal).
- **No metrics exist** for cancellation rate or no-show rate, though both are trivially derivable
  from `status` counts. Missing a dedicated `noShowAt` timestamp is a minor schema gap for
  time-ordered analysis (not needed for counts).

## 13. Customer ↔ Reservation ↔ Order ↔ Payment

```
Customer ──(scalar customerId)── Reservation ──(scalar orderId)── Order ──▶ Payment / PaymentTransaction
   │                                                                          │
   └──(relation orders)───────────────────────────────────────────────────────┘
```

- `Customer.orders` is a real Prisma relation; `Order.customerId` is required.
- `Reservation.customerId` and `Reservation.orderId` are **scalars with no declared relations**
  (indexed on `customerId`; **no index on `orderId`**).
- The reservation's order may also carry the same customer (guest/customer session) — so a customer
  can be linked both directly (`customerId`) and indirectly (`reservation.orderId → order.customerId`).
- **Achievable:** customer total/completed/cancelled reservations, no-show count, last reservation,
  reservation revenue (via `reservation.orderId ∈`), reservation frequency — all queryable.
- **Gap:** none of these are implemented; and `Reservation.orderId` lacks an index (§24).

## 14. Date Semantics

| Metric (intended) | Natural date field | Reason |
|---|---|---|
| Customer acquisition / "new customer" | `Customer.createdAt` | when the customer row was created |
| Customer revenue / orders / AOV | `Order.createdAt` | canonical revenue is order-date based (`revenueWhere`) |
| Customer refund impact | `Refund.approvedAt` | canonical refund attribution |
| Customer last visit / recency | `Order.createdAt` (paid) | last real sale |
| Reservation **booking date** | `Reservation.reservationDate` (`@db.Date`) | the business day reserved |
| Reservation **created** (acquisition) | `Reservation.createdAt` | when booked |
| Reservation confirm/seat/complete/cancel | the respective `*At` timestamps | first occurrence |
| Reservation revenue | linked `Order.createdAt` + `Refund.approvedAt` | canonical, same as every other report |

**Inconsistencies found:** the customer list mixes `Customer.createdAt` (ordering), `Order.createdAt`
(`lastOrderAt`) and raw `grandTotal` (spend) with an **unstated** basis; the reservation list's
"newest" sort uses `createdAt` while the "board" sort uses `reservationDate` (two different
"dates" for the same list — acceptable if labelled). No date filter exists on the customer list at
all (it lists all time). These must be documented once the reports are built.

## 15. Tenant Isolation

- `getCustomers`/`getCustomer`/`updateCustomer` are always `restaurantId`-scoped (session-derived);
  `GET/POST /api/customers` and `/api/customers/[id]` use `requireAdmin`/`requireRoles`.
- `listReservations`, `getReservationById`, `getReservationByCode`, `listCustomerReservations`,
  `cancelReservation` are all `restaurantId`-scoped.
- Evidence: no reservation links to a customer of another restaurant
  (`RES_CUSTOMER_FOREIGN_TENANT = 0`).
- **Result: OK.** No cross-restaurant leakage found; no client `restaurantId` is trusted.

## 16. Branch Isolation

- **Customers**: the list applies `orders.some.branchId ∈ branchFilters`, but the **customer row is
  restaurant-global** — a branch-scoped admin *can* see a customer who also ordered elsewhere as
  long as they ordered in-scope. **`getCustomer` (detail) has NO branch filter**, so a branch-scoped
  admin can read a customer's **last 10 orders across all branches** (PII/order leakage across
  branches). *Finding C3.*
- **Reservations**: `listReservations`/`getReservationById`/`getReservationByCode`/
  `transitionReservation` all honour `branchFilters` (`branchId ∈ branchFilters`), and the list
  rejects an out-of-scope explicit `branchId` with `ForbiddenError`. **Result: OK.**
- **Result: WARN** — customer detail is branch-unscoped (list is scoped).

## 17. Security / IDOR

- **C1 security (P1): the customers API returns the customer `password` (bcrypt hash).**
  `getCustomers` and `getCustomer` use Prisma `include` (not `select`), so every scalar — including
  `password` and `email` — is returned by `GET /api/customers` and `GET /api/customers/[id]`.
  `src/services/customer.service.ts` (`Customer.password`) confirms the field exists. *Finding C1.*
- IDOR: `/api/customers/[id]` uses `findFirst({ id, restaurantId })` → cross-tenant 404 (safe).
  `/api/admin/reservations/[id]` and `/code/[code]` are tenant+branch scoped (safe).
- Guest reservation lookup requires `code + normalized guestPhone` match (safe).
- Exports are ADMIN-only (`requireAdmin`) — the pattern to reuse.
- No password/session/payment secret is exposed by the reservation surfaces.

## 18. Performance

- **Customer list**: server-side pagination; `_count.orders` + a bounded `orders take:1`; spend via a
  single `order.groupBy` (indexed `customerId`). **No N+1, no full-scan to the client.** Good.
- **Customer detail**: 10 orders with items — bounded. Good.
- **Reservation list**: `findMany` + `count` + batched `reservationViews` (tables/branches/customers/
  orders fetched in 4 grouped queries). Good; no N+1 across rows.
- **Missing**: any aggregate/statistics endpoint (so nothing exists to be slow); the future
  Customer/Reservation reports should be **server-side `groupBy`/SQL aggregate** (never load all
  orders/reservations to the browser), matching the existing report engine style.
- **Index note**: `Reservation.orderId` has no index → a reservation-revenue query
  (`Order.id IN (SELECT orderId FROM reservation ...)`) would scan `reservation`; additive index
  recommended (§24). `Reservation` already has `[restaurantId, branchId, reservationDate, status]`.
- **Result: PASS** for existing paths; recommendations for the new reports.

## 19. Export

- Architecture exists: `src/lib/csv.ts` (`buildCsv`, RFC-4180 escaping + formula-injection guard)
  and ADMIN-only `/api/reports/<type>/export` routes (9 of them).
- **Customer Report CSV:** **Missing** (no route, no service method). → gap.
- **Reservation Report CSV:** **Missing** (no route, no service method). → gap.
- **Recommendation:** reuse `buildCsv` + the existing export route pattern; do not build a new
  export engine.

## 20. Existing Report Engine Reuse

`src/services/report/report.service.ts` is the canonical report engine and the correct place to add
customer/reservation reports — **do not create `customer-report.service.ts` /
`reservation-report.service.ts`**. Reuse:

- `revenueWhere` / `revenueScopeWhere` / `computeRefundRevenue` (canonical revenue),
- `resolveReportRange` (today/yesterday/week/month/custom),
- `branchFilters`/`authorizedBranches` contract,
- the `reportService` client wrapper + `/api/reports/*` + `ReportSubNav`.

Reservation/customer reports are **extensions**, not new engines.
`/admin/reports` subnav currently lists: Penjualan, Produk, Pembelian, Inventory, Per Shift,
Pembayaran, Multi Outlet, Profitabilitas, Menu Engineering — **no Customers/Reservations**.

## 21. Findings

### C1 — Customer API exposes the customer password hash (security)
Severity: **P1**
Existing functionality: `GET /api/customers` and `GET /api/customers/[id]` return customer rows.
Gap: the bcrypt `password` (and `email`) is returned in the JSON payload.
Root cause: `getCustomers`/`getCustomer` use Prisma `include` (all scalars) and the route returns the row as-is; no DTO/redaction.
Exact file: `src/services/customer/customer.service.ts`
Exact function: `CustomerService.getCustomers`, `CustomerService.getCustomer`
Current formula: `prisma.customer.findMany({ include: { _count, orders } })` / `findFirst({ include: { orders } })` → returns `password`, `email`, `whatsappId`.
Expected formula: explicit `select` allow-list (id, name, phone, email?, isActive, createdAt…) with `password` never selected.
Date basis: n/a
Tenant scope: restaurantId-scoped (OK)
Branch scope: list scoped, detail NOT scoped
Security impact: **credential hash exposure** to any authenticated ADMIN (PII/credential leak).
Performance impact: none
Recommended minimal fix: replace `include` with an explicit `select` (or strip `password`) in both methods.
Migration required: NO
API change: YES (removes leaking fields from the response — additive-safe for consumers)
UI change: NO
Regression risk: LOW

### C2 — Customer "totalSpent" uses raw gross, not canonical revenue
Severity: **P1**
Existing functionality: per-row `totalSpent` in the customers list.
Gap: includes CANCELLED orders and ignores refunds; not the PHASE 8/8B canonical revenue.
Root cause: `order.groupBy({ _sum: { grandTotal } })` with no status/refund predicate.
Exact file: `src/services/customer/customer.service.ts`
Exact function: `getCustomers`
Current formula: `Σ order.grandTotal` (any status, no refund subtraction)
Expected formula: canonical `revenueWhere` predicate (status ≠ CANCELLED AND (paymentStatus = PAID OR a collected-then-refunded payment exists)) minus `computeRefundRevenue` proportional reversal.
Date basis: `Order.createdAt` (currently unstated/all-time)
Tenant scope: restaurantId-scoped
Branch scope: branch-filtered spend but all-branch order count (C3)
Security impact: none
Performance impact: none (already grouped)
Recommended minimal fix: reuse `revenueWhere`/`computeRefundRevenue` for the customer scope, or explicitly relabel the field "Total order bruto (semua status)".
Migration required: NO
API change: field meaning changes (or label only)
UI change: YES (label/hint)
Regression risk: MEDIUM (number changes)

### C3 — Customer detail is branch-unscoped and mixes order scopes
Severity: **P2**
Existing functionality: `getCustomer` returns last 10 orders (with items).
Gap: (a) no `branchFilters` in the detail lookup → branch-scoped admin sees cross-branch orders; (b) list `orderCount` is all-branch while `totalSpent` is branch-only.
Root cause: `getCustomer(id, restaurantId)` ignores branch scope; list mixes `_count.orders` (unfiltered) with filtered spend.
Exact file: `src/services/customer/customer.service.ts`
Exact function: `getCustomer`, `getCustomers`
Current formula: detail `findFirst({ id, restaurantId })`; list `_count.orders` unfiltered vs `orders where branchId∈` filtered.
Expected formula: accept `branchFilters` in `getCustomer`; scope `_count` to the same branch predicate as spend.
Date basis: `Order.createdAt`
Tenant scope: OK
Branch scope: detail UNSCOPED (gap); list inconsistent
Security impact: cross-branch order/PII exposure to a branch-scoped admin.
Performance impact: none
Recommended minimal fix: thread `branchFilters` into `getCustomer`; align `_count` with the branch predicate.
Migration required: NO
API change: YES (detail gains branch behaviour; list count changes for branch-scoped callers)
UI change: possibly (empty-state)
Regression risk: LOW

### C4 — No Customer report/statistics (new/returning/active/AOV/segmentation)
Severity: **P2**
Existing functionality: list + per-row stats only.
Gap: no acquisition/retention/AOV/segmentation/active-inactive report; no date filter on the list.
Root cause: never implemented.
Exact file: `src/services/report/report.service.ts` (missing) + `src/app/admin/customers/page.tsx`
Exact function: — (none)
Current formula: —
Expected formula: server-side aggregates over `Customer`/`Order` with canonical revenue + documented dates.
Date basis: `Customer.createdAt` (acquisition), `Order.createdAt` (activity)
Tenant scope: restaurantId
Branch scope: through `orders.some.branchId ∈`
Security impact: ensure no password in the DTO (see C1)
Performance impact: must be server-side groupBy
Recommended minimal fix: add `getCustomerReport(restaurantId, period, …, branchFilters)` to `report.service.ts` + a `/admin/reports/customers` tab.
Migration required: NO
API change: YES (new endpoint)
UI change: YES
Regression risk: LOW

### C5 — No customer reservation metrics / history
Severity: **P2**
Existing functionality: `Reservation.customerId` (indexed scalar).
Gap: no per-customer reservation count/last reservation/no-show/revenue; `getCustomer` shows orders only.
Root cause: never implemented; Customer has no `reservations` relation.
Exact file: `src/services/customer/customer.service.ts` / `src/services/reservation/reservation.service.ts`
Exact function: `getCustomer`
Current formula: —
Expected formula: `reservation.groupBy({ by: [customerId], where: { restaurantId, customerId ∈, branchId ∈ } })` + counts by status.
Date basis: `Reservation.createdAt` / `reservationDate`
Tenant scope: restaurantId
Branch scope: `branchId ∈`
Security impact: none
Performance impact: server-side aggregate
Recommended minimal fix: add reservation counts to the customer detail/report.
Migration required: NO
API change: YES
UI change: YES
Regression risk: LOW

### C6 — No Customer CSV export
Severity: **P3**
Existing functionality: `src/lib/csv.ts` + `/api/reports/*/export` pattern.
Gap: no customer export.
Root cause: not implemented.
Exact file: `src/services/report/report.service.ts` / new `src/app/api/reports/customers/export/route.ts`
Exact function: — (none)
Current formula: —
Expected formula: reuse `buildCsv`, ADMIN-only, branch-scoped.
Date basis: documented
Tenant scope: restaurantId
Branch scope: authorizedBranches
Security impact: must NOT include password (C1); PII export ADMIN-only.
Performance impact: bounded/paginated
Recommended minimal fix: add route reusing `buildCsv` + a `getCustomersForExport`.
Migration required: NO
API change: YES
UI change: YES (button)
Regression risk: LOW

### C7 — Guest vs registered customer not classified
Severity: **P3**
Existing functionality: `Customer.phone` (`guest-…` placeholder), optional `password`/`email`.
Gap: no explicit `isGuest`/`isRegistered` flag exposed.
Root cause: classification is implicit in the placeholder-phone convention and auth fields.
Exact file: `src/services/customer/customer.service.ts`
Exact function: `getCustomers`
Current formula: —
Expected formula: derive `isRegistered = !!password || !!email`, `isGuest = phone.startsWith("guest-")` (documented), server-side.
Date basis: n/a
Tenant scope: restaurantId
Branch scope: n/a
Security impact: must not leak `password` while deriving the flag (C1)
Performance impact: none
Recommended minimal fix: add derived booleans to the DTO.
Migration required: NO
API change: YES (additive)
UI change: YES
Regression risk: LOW

### C8 — No Reservation report/statistics
Severity: **P2**
Existing functionality: list + detail + status workflow.
Gap: no counts by status, cancellation/no-show rate, party-size stats, by branch/date/table/source.
Root cause: never implemented.
Exact file: `src/services/report/report.service.ts` (missing) + `src/app/admin/reservations/page.tsx`
Exact function: — (none)
Current formula: —
Expected formula: `reservation.groupBy([status])`, `groupBy([branchId])`, `groupBy([reservationDate])`, party-size sums.
Date basis: `reservationDate` (business) / `createdAt` (acquisition)
Tenant scope: restaurantId
Branch scope: `branchId ∈ authorizedBranches`
Security impact: none
Performance impact: server-side groupBy
Recommended minimal fix: add `getReservationReport(...)` to the report engine + a report tab.
Migration required: NO
API change: YES
UI change: YES
Regression risk: LOW

### C9 — No Reservation revenue (canonical reuse possible)
Severity: **P2**
Existing functionality: `Reservation.orderId → Order` (canonical payment/revenue), `reservationViews` exposes order grandTotal/paymentStatus.
Gap: no reservation-scoped revenue/refund aggregation.
Root cause: never implemented; `Reservation.orderId` is an unindexed scalar.
Exact file: `src/services/report/report.service.ts`
Exact function: — (none)
Current formula: —
Expected formula: canonical `revenueWhere`/`computeRefundRevenue` scoped to `Order.id ∈ (Reservation.orderId in range)`; classify CANCELLED/unpaid/refunded with the canonical rules.
Date basis: linked `Order.createdAt` + `Refund.approvedAt`
Tenant scope: restaurantId
Branch scope: `Order.branchId ∈`
Security impact: none
Performance impact: needs an index on `Reservation.orderId` for the id-set join
Recommended minimal fix: extend the report engine with a reservation-order scope; no new revenue engine.
Migration required: NO (optional additive index, §24)
API change: YES
UI change: YES
Regression risk: LOW

### C10 — No Reservation funnel (and no reservation status history)
Severity: **P2**
Existing functionality: 6-state `ReservationStatus` + `confirmedAt/seatedAt/completedAt/cancelledAt`.
Gap: no funnel/conversion metric; no time-ordered transitions.
Root cause: never implemented; no `ReservationStatusHistory` table (unlike `OrderStatusHistory`).
Exact file: `src/services/reservation/reservation.service.ts` / `prisma/schema.prisma`
Exact function: `transitionReservation` (timestamps only)
Current formula: —
Expected formula: static funnel from status counts + timestamps (Created→Confirmed→Paid→Seated→Completed); a true path funnel would need a history table.
Date basis: the `*At` timestamps
Tenant scope: restaurantId
Branch scope: `branchId ∈`
Security impact: none
Performance impact: server-side counts
Recommended minimal fix: static status-count funnel (no history table needed); document the no-show timestamp gap.
Migration required: NO (for static funnel)
API change: YES
UI change: YES
Regression risk: LOW

### C11 — Reservation payment classification must follow canonical rules
Severity: **P3**
Existing functionality: `ReservationView.payment.status = Order.paymentStatus`.
Gap: no report distinguishes paid-but-order-cancelled / unpaid / refunded reservations.
Root cause: report not implemented.
Exact file: `src/services/report/report.service.ts`
Exact function: — (none)
Current formula: —
Expected formula: reuse canonical payment-status + refund semantics over the linked order.
Date basis: `Order.createdAt`
Tenant scope: restaurantId
Branch scope: `branchId ∈`
Security impact: none
Performance impact: none
Recommended minimal fix: part of C9's report; no separate engine.
Migration required: NO
API change: YES
UI change: YES
Regression risk: LOW

### C12 — No Reservation CSV export
Severity: **P3**
Existing functionality: `buildCsv` + export routes.
Gap: no reservation export.
Root cause: not implemented.
Exact file: new `src/app/api/reports/reservations/export/route.ts`
Exact function: — (none)
Current formula: —
Expected formula: reuse `buildCsv`, ADMIN-only, branch-scoped; no internal fields (orderId/customerId) beyond what the report shows.
Date basis: `reservationDate`
Tenant scope: restaurantId
Branch scope: authorizedBranches
Security impact: PII (guestPhone) → ADMIN-only (consistent with other exports)
Performance impact: bounded
Recommended minimal fix: add route reusing `buildCsv`.
Migration required: NO
API change: YES
UI change: YES
Regression risk: LOW

### C13 — Report subnav has no Customers/Reservations report tabs
Severity: **P3**
Existing functionality: `ReportSubNav` pills.
Gap: no customer/reservation report entry; the admin nav puts Customers/Reservations under Operations, not Reports.
Root cause: reports never existed.
Exact file: `src/components/admin/reports/report-nav.tsx`, `src/app/admin/layout.tsx`
Exact function: `ReportSubNav`, nav config
Current formula: —
Expected formula: add `{ href: "/admin/reports/customers" }` and `{ href: "/admin/reports/reservations" }` (admin-only).
Date basis: n/a
Tenant scope: n/a
Branch scope: n/a
Security impact: n/a
Performance impact: n/a
Recommended minimal fix: two subnav entries (no duplicate pages).
Migration required: NO
API change: NO
UI change: YES
Regression risk: LOW

### C14 — `Reservation.orderId` unindexed (report join cost)
Severity: **P3**
Existing functionality: `Reservation` indexes: `[restaurantId, branchId, reservationDate, status]`, `[tableId, reservationDate, status]`, `[customerId]`, `[guestPhone]`.
Gap: no index on `orderId` → reservation-revenue joins scan.
Root cause: `orderId` was added as a scalar without an index.
Exact file: `prisma/schema.prisma` (`model Reservation`)
Exact function: n/a
Current formula: —
Expected formula: additive `@@index([orderId])`.
Date basis: n/a
Tenant scope: n/a
Branch scope: n/a
Security impact: none
Performance impact: JOIN/`IN` scan on `reservation`
Recommended minimal fix: additive index (only if reservation revenue is implemented).
Migration required: **YES (additive, optional)** — see §24
API change: NO
UI change: NO
Regression risk: LOW

### C15 — No date filter / no reporting periods on the customer & reservation list
Severity: **P3**
Existing functionality: reservation list has `date` (single day) + status; customer list has none.
Gap: no period ranges for either.
Root cause: lists are operational, not report-period aware.
Exact file: `src/app/admin/customers/page.tsx`, `src/app/admin/reservations/page.tsx`
Exact function: `getCustomers`, `listReservations`
Current formula: —
Expected formula: reuse `resolveReportRange` for the future report endpoints.
Date basis: per §14
Tenant scope: restaurantId
Branch scope: authorizedBranches
Security impact: none
Performance impact: none
Recommended minimal fix: implement periods in the report endpoints (C4/C8), not the operational lists.
Migration required: NO
API change: YES (report only)
UI change: YES (report only)
Regression risk: LOW

## 22. Priority Matrix

| Area | Existing | Partial | Missing | Duplicate | Risk |
|---|---|---|---|---|---|
| Customer Report | list only | detail | report/statistics page | no | P2 |
| Customer Statistics | — | per-row count/spend | new/returning/active/AOV/segmentation | no | P2 |
| Customer Revenue | raw only | — | canonical revenue | no (would duplicate if built) | P1 |
| Customer Order Metrics | per-row | scope-inconsistent | status split/AOV | no | P2 |
| Customer Reservation Metrics | — | queryable | surfaced metrics | no | P2 |
| Reservation Report | list/detail | — | statistics page | no | P2 |
| Reservation Statistics | — | — | status/rate/party aggregates | no | P2 |
| Reservation Revenue | — | link exists | revenue report | no | P2 |
| Reservation Funnel | — | status+timestamps | funnel metric | no | P2 |
| Reservation Payment | view derives status | — | classification report | no | P3 |
| Reservation Cancellation | workflow | — | cancellation-rate metric | no | P2 |
| No-show | workflow | — | no-show-rate metric | no | P2 |
| Branch Report | list scoped | customer detail unscoped | per-branch report | no | P2 |
| Tenant Isolation | OK | — | — | no | OK |
| Export | engine exists | — | Customer/Reservation CSV | no | P3 |
| API | customer list/detail, reservation list/detail | — | report endpoints | no | P2 |
| UI | customers/reservations ops pages | — | report tabs/stat cards | no | P3 |
| Performance | good existing | — | report aggregates | no | OK |
| Security | auth OK | — | **password leak** | no | **P1** |

**Legend:** Existing = works today; Partial = works but incomplete/💡 inconsistent; Missing = absent;
Duplicate = would duplicate if built naïvely (guard: reuse the report engine).

## 23. Recommended Minimal Implementation (PHASE 9B, not coded)

**P0** — none.

**P1**
1. **Redact the customer password** (C1): explicit `select` in `getCustomers`/`getCustomer`
   (`id, name, phone, email, isActive, createdAt, updatedAt` + stats). File:
   `src/services/customer/customer.service.ts`. Migration NO · API change YES (safer) · UI NO ·
   regression LOW.
2. **Canonical customer revenue** (C2): reuse `revenueWhere` + `computeRefundRevenue` for customer
   spend; or relabel to gross. File: `customer.service.ts` (+ `report.service.ts` helper). Migration
   NO · API YES · UI YES (label) · regression MEDIUM.

**P2**
3. **Customer report/statistics** (C4): `reportService.getCustomerReport(restaurantId, period,
   startDate, endDate, branchFilters)` using `groupBy` (new/returning, active/inactive, orders, AOV,
   item qty, canonical net) + `/api/reports/customers` + `/admin/reports/customers` page +
   `ReportSubNav` entry. Migration NO · API YES · UI YES · regression LOW.
4. **Reservation report/statistics + funnel** (C8/C10): `reportService.getReservationReport(...)`
   with `groupBy([status])`, rates (cancel/no-show), party-size, by branch/date/source, and the
   static funnel from statuses+timestamps. + page/tab/endpoint. Migration NO · API YES · UI YES ·
   LOW.
5. **Reservation revenue** (C9/C11): scope `revenueWhere`/`computeRefundRevenue` to
   `Order.id ∈ Reservation.orderId` in range; classify cancelled/unpaid/refunded canonically. +
   additive `@@index([orderId])` ONLY if measured slow. Migration NO (or additive index) · API YES ·
   UI YES · LOW.
6. **Customer detail branch scope + reservation metrics** (C3/C5): thread `branchFilters`; add
   reservation counts. Migration NO · API YES · UI YES · LOW.

**P3**
7. Customer + Reservation **CSV export** (C6/C12) reusing `buildCsv` + ADMIN export routes.
   Migration NO · API YES · UI YES · LOW.
8. Guest/registered classification (C7), no-show timestamp documentation (C10), subnav entries
   (C13). Migration NO · LOW.

**Explicitly do NOT build:** `customer-report.service.ts`, `reservation-report.service.ts`, any new
revenue engine, a duplicate reservation/order/payment engine, or a `ReservationStatusHistory` table
(unnecessary for the static funnel).

## 24. Migration Assessment

**No migration is required for the core Customer/Reservation reports** — every metric is derivable
from existing tables (`Customer`, `Reservation`, `Order`, `OrderItem`, `Payment`, `Refund`) and
existing timestamp/status columns.

Optional, **additive-only** improvements (do NOT implement in this audit phase):
- `@@index([orderId])` on `reservation` — helps the reservation-revenue JOIN/`IN`; safe, additive,
  no data change.
- A `noShowAt` timestamp (or a `ReservationStatusHistory` table) — only needed for **time-ordered**
  funnel/duration analytics; not needed for status-count metrics. Additive; a history table would be
  new (bigger change), justified only if drop-off analysis is required.

No schema field/relation is required for the recommended P1/P2 reports. No reset, no `db push`, no
migration in this phase.

## 25. API / UI Impact

| Change | API | UI |
|---|---|---|
| Redact password (C1) | response fields removed | none |
| Canonical customer revenue (C2) | value/label | label/hint |
| Customer report (C4) | `GET /api/reports/customers` | `/admin/reports/customers` + tab |
| Reservation report (C8/C10) | `GET /api/reports/reservations` | `/admin/reports/reservations` + tab |
| Reservation revenue (C9) | included in reservation report | stat cards |
| Customer/reservation export (C6/C12) | `GET /api/reports/{customers,reservations}/export` | Export button |
| Branch scope detail (C3) | detail honours branch | empty-state |

All new endpoints follow the existing ADMIN + `authorizedBranches` contract; no auth change.

## 26. Regression Risk

- **LOW** for the reporting additions (new endpoints/pages; existing engines untouched).
- **MEDIUM** for C2 if customer spend changes meaning — mitigate by relabelling or an explicit
  "gross vs net" toggle, and by not changing the canonical revenue formula.
- **LOW** for C1 redaction (removes fields; additive-safe for consumers that ignore them).
- Reserved risk: reuse `revenueWhere`/`computeRefundRevenue` so Customer/Reservation revenue stays
  identical to the Sales Report (PHASE 8/8B consistency).

## 27. Final Verdict

**PASS** — existing customer/reservation **workflows, list/detail, status transitions, tenant &
branch scoping (reservations), pagination, batched lookups, and the CSV/export + report-engine reuse
surfaces**.
**WARN** — Customer revenue is raw (not canonical); customer detail is branch-unscoped with mixed
list scopes; Customer/Reservation **reports, statistics, revenue, funnel and exports are missing**;
Reservation has no history table (static funnel only).
**BLOCKER** — the **customer password hash is exposed** by `GET /api/customers` /
`GET /api/customers/[id]` (C1) and must be redacted.

**Complete:** reservation lifecycle + scoping; customer CRUD/list; export engine; canonical report
engine.
**Partial:** customer detail/stats; reservation `ReservationView` (order/payment hydrated but no
aggregates).
**Missing:** customer report/statistics/revenue/segmentation; reservation report/statistics/revenue/
funnel; both exports; report tabs.
**Duplicate:** none today — guard against building new customer/reservation report engines.
**Fix:** C1 (redact) first; then C2 (canonical revenue); then C4/C8/C9/C10 reports + exports.
**Do NOT touch:** Customer Auth, Reservation purchase/payment flow, Order/Payment engines,
canonical revenue formula, tenant isolation, Print Bill, Promo, WhatsApp.

**PHASE 9B recommendation: YES** (targeted reporting + one redaction) — no new engines, **no
migration required**.

**STOP after this audit.** No coding, no migration, no DB write, no commit/push/deploy.
