# PHASE 9B — CUSTOMER & RESERVATION REPORT IMPLEMENTATION

**Repo:** `/home/reksa/restorant-cafe`
**HEAD:** `d7f29ac` (unchanged — nothing committed, pushed, or deployed)
**Source of truth:** `PHASE9-CUSTOMER-RESERVATION-REPORT-AUDIT.md` (C1–C15)
**Canonical revenue rule:** `PHASE8-FINANCE-CONSISTENCY-AUDIT.md` / `PHASE8B-FINANCE-CONSISTENCY-HARDENING-REPORT.md`
**Date executed:** 2026-10-08

---

## 1. Executive Summary

PHASE 9B implements exactly the PHASE 9 findings **C1–C6, C8–C13** (C7 optional, not
implemented — see §28), with the smallest change that satisfies the requirement, reusing the
existing engines and **never touching the canonical revenue formula**.

Delivered:

| Finding | What was implemented | Where |
|---|---|---|
| C1 | Customer password (and internal `whatsappId`) redaction via explicit Prisma `select` | `src/services/customer/customer.service.ts` |
| C2 | Canonical, refund-aware customer spend (was raw `Σ grandTotal` over all statuses) | `customer.service.ts` + `computeCustomerRevenue` in `report.service.ts` |
| C3 | Customer detail + list order counts branch-scoped (`branchFilters` threaded server-side) | `customer.service.ts`, `src/app/api/customers/[id]/route.ts` |
| C4 | `getCustomerReport(...)` — customer statistics | `report.service.ts` |
| C5 | Per-customer reservation metrics (incl. reservation revenue) | `report.service.ts` (`getCustomerReport`) |
| C6 | `GET /api/reports/customers/export` | new route |
| C8 | `getReservationReport(...)` — reservation statistics | `report.service.ts` |
| C9 | Reservation revenue via the canonical engine (reservation-linked order ids) | `report.service.ts` |
| C10 | Static reservation funnel (no `ReservationStatusHistory`) | `report.service.ts` |
| C11 | Reservation payment classification from `Order.paymentStatus` | `report.service.ts` |
| C12 | `GET /api/reports/reservations/export` (per-reservation, canonical revenue) | new route + `getReservationsForExport` |
| C13 | `ReportSubNav` gains Customers + Reservations | `src/components/admin/reports/report-nav.tsx` |

Also delivered: 4 API routes (PART 13), 2 admin UI pages (PART 14/15), client wrapper contracts,
server-side-only aggregation (PART 16), and verification (PART 20).

**Verification:** `npx tsc --noEmit` → **0 errors**; `npm run build` → **exit 0** (4 new API routes
+ 2 new pages compiled); `git diff --check` → **clean**; runtime harness → **31/31 checks PASS**
(customer 10, reservation 11, revenue comparisons 2, DB 3, plus C1/C3/C11/fixture checks).
DB counts are identical before/after; `ORD-20260908-HCOK1L` remains `CANCELLED` / `PAID`.
**No migration. No schema change. No commit.**

---

## 2. C1 — Password Redaction

- **Existing functionality:** `getCustomers()` and `getCustomer()` used Prisma `include` with no
  `select`, returning **all** Customer scalars, including the bcrypt `password` and internal
  `whatsappId`, through `GET /api/customers` and `GET /api/customers/[id]`. `updateCustomer()` and
  `findOrCreateCustomer()` also returned the full row (so `POST /api/customers` and `PUT
  /api/customers/[id]` leaked the hash too).
- **Change:** Introduced `CUSTOMER_PUBLIC_SELECT` = `{ id, name, phone, email, isActive,
  createdAt, updatedAt }` and applied it to **every** return path (`getCustomers`, `getCustomer`,
  `updateCustomer`, `findOrCreateCustomer`). `password` and `whatsappId` are not in the allow-list.
- **Exact file:** `src/services/customer/customer.service.ts`
- **Exact function:** `getCustomers`, `getCustomer`, `updateCustomer`, `findOrCreateCustomer`.
- **Formula:** n/a (field allow-list).
- **Date semantics:** n/a.
- **Tenant scope:** unchanged (`restaurantId` from session).
- **Branch scope:** unchanged (see C3).
- **Security impact:** **The customer password hash can no longer leave the server from any of
  these four methods.** Verified over HTTP (`GET /api/customers`, `GET /api/customers/[id]`) and at
  the service level: no `password` key in any serialized response; CSV also contains no `password`.
- **Performance impact:** none (a narrower projection).
- **API impact:** response now contains exactly `id, name, phone, email, isActive, createdAt,
  updatedAt, orderCount, totalSpent, lastOrderAt` (list) / the same + `orders` (detail). The
  existing admin customer page reads only `name/phone/orderCount/totalSpent/lastOrderAt`, which are
  all present.
- **UI impact:** none.
- **Migration impact:** none.
- **Regression risk:** low. `findOrCreateCustomer` no longer returns the full row to internal
  callers — audit confirmed the only caller (`POST /api/customers`) returns it to the client, which
  is exactly what we must not leak.

---

## 3. C2 — Canonical Customer Revenue

- **Existing functionality:** `getCustomers().totalSpent` was `prisma.order.groupBy({ _sum:
  grandTotal })` over **all** order statuses with **no refund subtraction** (audit C2: raw 1.138.700
  vs non-cancelled 905.700).
- **Change:** Added `computeCustomerRevenue()` in the existing report service (derived from the
  canonical engine — same predicate, same refund math, different GROUP BY), and switched the list's
  `totalSpent` to its refund-aware `netSales`.
- **Exact file:** `src/services/report/report.service.ts` (helper) + `src/services/customer/customer.service.ts` (caller).
- **Exact function:** `computeCustomerRevenue(...)`, `CustomerService.getCustomers`.
- **Formula (identical to canonical `revenueWhere` + `computeRefundRevenue`):**
  - `productRevenue(customer)` = Σ over orders where `status <> 'CANCELLED'` AND (`paymentStatus =
    'PAID'` OR EXISTS payment `REFUNDED`), of `grandTotal − tax − serviceCharge`.
  - `refundRevenue(customer)` = Σ over APPROVED refunds, of
    `min(refunded / grandTotal, 1) × (grandTotal − tax − serviceCharge)`.
  - `netSales(customer)` = `productRevenue − refundRevenue` (per-order refund cap ⇒ never negative).
- **Date semantics:** the list is **all-time** (`range = null` ⇒ both halves date-free). The report
  passes the period range (product half on `Order.createdAt`, refund half on `Refund.approvedAt`).
- **Tenant scope:** `restaurantId` always (raw SQL + JOIN predicate).
- **Branch scope:** `Order.branchId IN (authorizedBranches)` when scoped.
- **Security impact:** none new (server-side aggregation only; no orders streamed to the browser).
- **Performance impact:** one grouped raw SQL query per request (indexed by `Order.customerId`,
  `Order.branchId`), bounded by the page's customer ids — no N+1.
- **API impact:** `totalSpent` is now canonical net revenue (was raw grand-total sum).
- **UI impact:** the "Total Belanja" figure now excludes CANCELLED orders and nets refunds.
- **Migration impact:** none.
- **Regression risk:** medium-low — the figure changes by design (that is the finding). Verified
  `#6b` (list `totalSpent` == `computeCustomerRevenue.netSales`).
- **The canonical formula itself was NOT modified.**

---

## 4. C3 — Customer Detail Branch Scope

- **Existing functionality:** `getCustomer(id, restaurantId)` took no `branchFilters`, so a
  branch-scoped admin saw orders from **other** branches. The list mixed an all-branch
  `_count.orders` with a branch-filtered spend.
- **Change:**
  - `getCustomer(id, restaurantId, branchFilters?)` now filters `orders` by `branchId IN (...)`.
  - `GET /api/customers/[id]` passes `authorizedBranches(ctx)` (server-derived — never a client id).
  - `getCustomers` `_count.orders` is now a **filtered relation count** scoped to the same branches
    as the spend.
- **Exact file:** `src/services/customer/customer.service.ts`; `src/app/api/customers/[id]/route.ts`.
- **Exact function:** `getCustomer`, `getCustomers`; route `GET`.
- **Formula:** n/a.
- **Date semantics:** none added (operational customer identity stays restaurant-global; only order
  visibility is scoped).
- **Tenant scope:** `restaurantId` from session.
- **Branch scope:** `branchId: { in: authorizedBranches(ctx) }` — a branch-scoped user can no longer
  read another branch's orders through the customer detail. For an unscoped admin,
  `authorizedBranches` returns `undefined` (= all branches), which is the documented default.
- **Security impact:** closes a cross-branch read (`C3`).
- **Performance impact:** the filtered `_count` compiles to a scoped `COUNT`; no N+1.
- **API impact:** detail `orders` and list `orderCount` are now branch-scoped for scoped users.
- **UI impact:** a branch-scoped operator sees only their branches' orders (correct).
- **Migration impact:** none.
- **Regression risk:** low. Verified `C3.4`: for a customer with 1 order in MAIN —
  all=1, `[MAIN]`=1, `[OTHER]`=0, exactly matching the DB per-branch counts.

---

## 5. C4 — Customer Report / Statistics

- **Existing functionality:** none (`getCustomerReport` did not exist; no `/admin/reports/customers`).
- **Change:** Added `ReportService.getCustomerReport(...)` returning a summary + per-customer rows.
- **Exact file:** `src/services/report/report.service.ts`
- **Exact function:** `getCustomerReport(restaurantId, period, { startDate, endDate, branchFilters, search })`.
- **Formula / definitions (documented, no new schema field):**
  - **Scoped customers** = customers `createdAt ∈ period` **OR** with ≥1 non-cancelled order in the
    period (branch-scoped). Hard cap `CUSTOMER_REPORT_MAX_ROWS = 5000`.
  - `totalCustomers` = scoped customers returned.
  - `newCustomers` = scoped customers with `Customer.createdAt ∈ period`.
  - `returningCustomers` = has an order in the period AND first-ever non-cancelled order `< range.start`.
  - `activeCustomers` = has ≥1 non-cancelled order in the period.
  - `inactiveCustomers` = no order in the period AND has an earlier non-cancelled order.
  - `totalOrders` = Σ revenue-set order count.
  - `grossSales` = Σ `subtotal` over the revenue set; `totalSales` = Σ `grandTotal` over the revenue set.
  - `totalRefund` = Σ APPROVED refunds (approval-date attributed); `netSales` = canonical product − refund.
  - `averageOrderValue` = `totalSales / totalOrders` (exactly the Sales Report basis).
  - Per customer: `orders, items, grossSales, totalSales, refund, netSales, aov, firstOrderAt,
    lastOrderAt, reservations{...}, isNewCustomer, isReturning`.
- **Date semantics:** activity/acquisition = `Order.createdAt`; customer acquisition = `Customer.createdAt`.
- **Tenant scope:** `restaurantId` (session).
- **Branch scope:** expressible only through orders/reservations (Customer has no `branchId`).
- **Security impact:** public customer fields only (no password); server aggregates only.
- **Performance impact:** ≤6 batched queries (activity, all-time first order, canonical revenue,
  reservation metrics, reservation revenue, customer rows) — no per-customer query.
- **API impact:** new `GET /api/reports/customers`.
- **UI impact:** new `/admin/reports/customers` page.
- **Migration impact:** none.
- **Regression risk:** none (new method).
- **Consistency evidence (#22):** full-year scope A: `totalSales 517000`, `grossSales 517000`,
  `totalOrders 16`, `items 0`, `totalRefund 30000`, `netSales 487000`, `AOV 32312.5`
  — **all seven match the canonical Sales Report for the same scope exactly.**

---

## 6. C5 — Customer Reservation Metrics

- **Existing functionality:** none (`Reservation.customerId` is an indexed scalar with no relation).
- **Change:** `getCustomerReport` now returns, per customer, `reservations { total, confirmed,
  seated, completed, cancelled, noShow, lastReservationDate, revenue, refund, netSales }`.
- **Exact file / function:** `report.service.ts` → `getCustomerReport`.
- **Formula:** counts via one raw SQL `GROUP BY customerId` over `reservation` (status sums); revenue
  via `computeCustomerRevenue` restricted to that customer set AND to the reservation-linked order
  ids (`extraOrderFilter: o.id IN (...)`), i.e. the canonical engine.
- **Date semantics:** reservation metrics scoped by `Reservation.reservationDate ∈ period`; revenue
  by the canonical basis.
- **Tenant scope:** `reservation.restaurantId` + `restaurantId`.
- **Branch scope:** `reservation.branchId IN (authorizedBranches)`.
- **Security impact:** none new.
- **Performance impact:** 2 batched queries (metrics + reservation-linked order lookups) — no N+1.
- **API/UI impact:** fields surface in `GET /api/reports/customers` and the customers page.
- **Migration impact:** none (no Prisma relation added — scalar join by `customerId`).
- **Regression risk:** none.
- **Evidence (#9):** with a fixture reservation linked to a paid+refunded order, the owning
  customer's row shows `reservations.total=1`, `reservations.revenue=30000`.

---

## 7. C6 — Customer CSV Export

- **Existing functionality:** none.
- **Change:** new `GET /api/reports/customers/export`.
- **Exact file:** `src/app/api/reports/customers/export/route.ts`.
- **Exact component/function:** route `GET`; reuses `buildCsv` from `src/lib/csv.ts`.
- **Formula:** identical semantics to `getCustomerReport` (same service call).
- **Fields:** `Customer, Phone, Email, Orders, Reservations, Items, Gross Sales, Refund, Net Sales,
  AOV, First Order, Last Order`.
- **Date semantics:** same as the report.
- **Tenant scope:** session `restaurantId`.
- **Branch scope:** explicit validated `branchId` param, else `authorizedBranches`.
- **Security impact:** **ADMIN-only**; no password/secret columns; `csvCell` formula-injection guard.
- **Performance impact:** one report call (batched).
- **API impact:** new endpoint.
- **UI impact:** Export button (ADMIN) on `/admin/reports/customers`.
- **Migration impact:** none.
- **Regression risk:** none.
- **Evidence:** HTTP 200, 3.226 bytes, header row correct, `grep -c password` = 0.

---

## 8. C8 — Reservation Report / Statistics

- **Existing functionality:** none (`getReservationReport` / `/admin/reports/reservations` did not exist).
- **Change:** Added `ReportService.getReservationReport(...)`.
- **Exact file / function:** `report.service.ts` → `getReservationReport(restaurantId, period, { startDate, endDate, branchFilters })`.
- **Summary:** `totalReservations, pending, confirmed, seated, completed, cancelled, noShow,
  cancellationRate, noShowRate, averagePartySize, totalGuests, withOrder, withoutOrder,
  reservationRevenue, reservationRefund, reservationNetRevenue`.
- **Breakdowns:** `byStatus`, `byBranch`, `bySource`, `byPartySize`, `byTable`, `byDate`, `paymentStatus`.
- **Formulas:** `cancellationRate = cancelled/total × 100`; `noShowRate = noShow/total × 100`;
  `averagePartySize = totalGuests/total`.
- **Date semantics:** **business date = `Reservation.reservationDate`** (the report's date range is
  re-anchored at UTC midnight via `resolveReservationDateRange`, matching the write path
  `dbDateFromDateOnly`). `confirmation`/`seating`/`completion` use the existing timestamps.
  **Booking/acquisition date (`createdAt`) is NOT mixed in** — the export exposes it separately.
- **Tenant scope:** `restaurantId`.
- **Branch scope:** `reservation.branchId IN (authorizedBranches)`.
- **Security impact:** ADMIN-only API; no secrets.
- **Performance impact:** ~10 batched queries (`groupBy`/`aggregate` + 2 raw) + 2 lookup queries
  (branch/table names) — no N+1.
- **API impact:** new `GET /api/reports/reservations`.
- **UI impact:** new `/admin/reports/reservations` page.
- **Migration impact:** none.
- **Regression risk:** none (new method).
- **Evidence (#11–15):** with 5 fixtures: total 5, confirmed 2, completed 1, cancelled 1 (20%),
  no-show 1 (20%), guests 20, avg party size 4 — all as expected.

---

## 9. C9 — Reservation Revenue

- **Existing functionality:** none.
- **Change:** reservations in scope → collect their `orderId`s once → feed the **canonical engine**.
- **Exact file / function:** `report.service.ts` → `getReservationReport` (and `getReservationsForExport`).
- **Formula:**
  1. `orderIds` = distinct non-null `Reservation.orderId` for reservations in the scoped period.
  2. `computeRefundRevenue({ restaurantId, start, end, branchFilters, extraOrderFilter:
     Prisma.sql\`AND o.id IN (orderIds)\` })` → `{ productRevenue, refundRevenue, netSales }`.
- **Explicitly NOT used:** `SUM(reservation.order.grandTotal)`.
- **Handles:** unpaid/failed/expired (not on the revenue set ⇒ 0); PAID; fully/partially refunded
  (H3.4 semantics); cancelled orders (`status <> 'CANCELLED'` predicate ⇒ excluded).
  **Reservations without `orderId` have no revenue (0).**
- **Date semantics:** product revenue attributed by `Order.createdAt` within the report range;
  refunds by `Refund.approvedAt` (canonical H4.5-B1).
- **Tenant/branch scope:** `restaurantId` + `branchFilters` inside the canonical SQL.
- **Security impact:** none new.
- **Performance impact:** one `IN (orderIds)` PK lookup inside the canonical query — see C14 (§30).
- **API/UI impact:** summary `reservationRevenue / reservationRefund / reservationNetRevenue` +
  funnel "paid" stage; surfaced in the reservations page and the customer report.
- **Migration impact:** **none required** (see §30).
- **Regression risk:** none **because the canonical `computeRefundRevenue` was called, not
  reimplemented**. Evidence (#16/#16b/#18/#23): fixture product revenue 30000 with a 30000 full
  refund → net **0**, and the report's `reservationNetRevenue` == an independent
  `computeRefundRevenue` call for the same order ids (**#23 PASS**).

---

## 10. C10 — Static Reservation Funnel

- **Existing functionality:** none.
- **Change:** a **static** funnel derived from the existing status column and the existing
  `confirmedAt`/`seatedAt`/`completedAt` timestamps. **No `ReservationStatusHistory` table, no new
  field.**
- **Exact file / function:** `report.service.ts` → `getReservationReport` (`funnel`), one raw SQL query.
- **Stages:** `Created` (COUNT) → `Confirmed` (`confirmedAt IS NOT NULL`) → `Paid`
  (`orderId` linked to an order on the canonical revenue set) → `Seated` (`seatedAt IS NOT NULL`) →
  `Completed` (`completedAt IS NOT NULL`). Separate outcomes: `Cancelled` (`status='CANCELLED'`),
  `No-show` (`status='NO_SHOW'`).
- **No-show semantics (documented):** there is **no `noShowAt`** column; the no-show outcome is
  derived from the current `status`. This is a point-in-time snapshot, not an event history — that
  is the accepted limitation of not adding a history table.
- **Date/tenant/branch scope:** same as the reservation report.
- **Security impact:** none.
- **Performance impact:** one raw aggregate query.
- **API/UI impact:** funnel card on `/admin/reports/reservations`.
- **Migration impact:** none.
- **Regression risk:** none.
- **Evidence:** funnel `{created:5, confirmed:4, paid:1, seated:1, completed:1, cancelled:1, noShow:1}`.

---

## 11. C11 — Reservation Payment Classification

- **Existing functionality:** `ReservationView.payment.status = Order.paymentStatus` (reservation
  service). The report previously did not exist.
- **Change:** the report exposes a `paymentStatus` map computed from the **existing
  `Order.paymentStatus`** of reservation-linked orders, plus a synthetic `NO_ORDER` bucket for
  reservations with no order. The funnel's "paid" stage uses the canonical revenue predicate.
- **Exact file / function:** `report.service.ts` → `getReservationReport` (`paymentStatus`, `funnel.paid`).
- **Formula:** `PaymentStatus` buckets = `prisma.order.groupBy({ by: ["paymentStatus"], where: { id: { in: orderIds } } })`;
  `NO_ORDER = totalReservations − withOrder`.
- **No new payment engine was created.**
- **Date/tenant/branch scope:** same as the reservation report.
- **Security impact:** none.
- **API/UI impact:** "Status Pembayaran" card on the reservations page.
- **Migration impact:** none.
- **Regression risk:** none.
- **Evidence:** fixture classification `{NO_ORDER:3, UNPAID:1, PAID:1}` — the fully-refunded order is
  `UNPAID` (H3.4), the CANCELLED-but-paid historical order is `PAID` (the documented
  "cancelled order with payment" case).

---

## 12. C12 — Reservation CSV Export

- **Existing functionality:** none.
- **Change:** new `GET /api/reports/reservations/export` + `ReportService.getReservationsForExport(...)`.
- **Exact files:** `src/app/api/reports/reservations/export/route.ts`, `report.service.ts`.
- **Fields:** `Kode, Tanggal, Jam, Customer, Telepon, Jumlah Tamu, Cabang, Meja, Sumber, Status,
  Status Pembayaran, Revenue, Dibuat`.
- **Formula:** per-reservation `revenue` = canonical per-order net computed from **batched** order
  rows and APPROVED refunds (`product = grandTotal − tax − serviceCharge`; `refund =
  min(refunded/grandTotal,1) × product`; `revenue = product − refund`), 0 when the reservation has
  no order or its order is not on the revenue set.
- **Date semantics:** reservation date; `Dibuat` = `createdAt`.
- **Tenant/branch scope:** session `restaurantId` + validated branch scope.
- **Security impact:** ADMIN-only; no internal secrets; uses `buildCsv` (BOM + CRLF + formula guard).
- **Performance impact:** 1 reservations query + 4 batched lookups (orders, refunds, customers,
  branches, tables) — no per-row query.
- **Migration impact:** none.
- **Regression risk:** none.
- **Evidence:** HTTP 200, header + data row correct; export revenue for the fixture (full refund)
  == 0 == the report's net (**#21b PASS**).

---

## 13. C13 — Navigation

- **Existing functionality:** `ReportSubNav` listed Penjualan/Produk/Pembelian/Inventory/Per
  Shift/Pembayaran/Multi Outlet/Profitabilitas/Menu Engineering.
- **Change:** added `Customers` and `Reservations` (both `adminOnly: true`) after Pembayaran.
- **Exact file / component:** `src/components/admin/reports/report-nav.tsx` → `REPORTS` array.
- **Scope/security/perf/migration:** none.
- **UI impact:** two new pills; **no duplicate admin pages** (the existing `/admin/customers` and
  `/admin/reservations` operational pages are untouched — C15).
- **Regression risk:** none.

---

## 14. API Changes

Four new endpoints only (PART 13), all **ADMIN-only**, `restaurantId` from the session, branch scope
server-derived, dates validated by `resolveReportRange`:

| Method | Path | Service call |
|---|---|---|
| GET | `/api/reports/customers` | `getCustomerReport` |
| GET | `/api/reports/customers/export` | `getCustomerReport` + `buildCsv` |
| GET | `/api/reports/reservations` | `getReservationReport` |
| GET | `/api/reports/reservations/export` | `getReservationsForExport` + `buildCsv` |

- **No client `restaurantId`, totals, or revenue are trusted.**
- The explicit `branchId` query param is validated by `requireAdmin(branchId)` /
  `requireRestaurantContext` (must belong to the user's restaurant and, for scoped users, to their
  assignments).
- Error envelope unchanged (`{success:false, message, error}`).

---

## 15. UI Changes

- **New** `/admin/reports/customers` — period pills (Hari Ini/Kemarin/Minggu Ini/Bulan Ini/Custom),
  explicit date inputs, branch filter, search, 11 summary cards, a customer table
  (orders/reservations/items/total/refund/net/AOV/last order), Export CSV, and
  loading/empty/error states.
- **New** `/admin/reports/reservations` — period pills + custom dates + branch filter, 10 summary
  cards, static funnel, breakdowns (status/branch/source/payment), a per-date table, Export CSV,
  and loading/empty/error states.
- Both reuse `ReportSubNav`, `ReportBranchFilter`, `Card`, `Table`, `Button`, `Badge` — **no admin
  UI redesign**.

---

## 16. Database Changes

**None.** No migration, no schema/DDL/DML, no seed, no `prisma db push`, no migration file added.
`reservation`'s existing indexes (`[restaurantId, branchId, reservationDate, status]`,
`[tableId, reservationDate, status]`, `[customerId]`, `[guestPhone]`) and `order`'s
(`[customerId]`, `[branchId]`, `[createdAt]`) cover every new query. See §30 for the C14 assessment.

---

## 17. Security

- **C1 verified:** `GET /api/customers` and `GET /api/customers/[id]` return **no `password` key**
  (service allow-list on all four customer methods); the customers CSV contains no `password`.
- **Scope:** every new query is `restaurantId`-scoped with an explicit tenant predicate (raw SQL
  includes `r.restaurantId = ?` / `o.restaurantId = ?`).
- **Branch:** `authorizedBranches(ctx)` / validated `branchId` param; a branch-scoped user cannot
  widen scope.
- **Auth:** all four endpoints are `requireAdmin`.
- **No secret exposed:** password hash, session/auth data, payment provider secrets, and
  `whatsappId` are never selected.

---

## 18. Tenant Isolation

- Customer/reservation reports always use the session `restaurantId`.
- Service-level (`#20`): restaurant B → `totalReservations 0`, `totalCustomers 0`, `totalSales 0`.
- HTTP-level: a branch id belonging to restaurant B → **403 "Cabang tidak ditemukan"** (validated
  against the caller's restaurant).

---

## 19. Branch Isolation

- Reports: explicit validated `branchId` param, else `authorizedBranches(ctx)`.
- HTTP-level: `?branchId=OTHER` → customer `totalSales 367000 / 11 orders`, **MAIN** →
  `150000`; **367000 + 150000 = 517000 = the all-branch total** (the branch split reconciles
  exactly). Reservations: OTHER `0`, MAIN `1`.
- Customer detail (`#C3.4`): `[OTHER]` returns 0 orders for a MAIN-only customer.
- Note: for an **unscoped** admin the `x-branch-id` header is a UX hint only (`authorizedBranches`
  returns `undefined`); this is the **pre-existing, documented** behaviour shared with the sales
  report — the explicit `branchId` param is the scoping mechanism.

---

## 20. Performance

- **All aggregation is server-side** (`aggregate` / `groupBy` / raw SQL). No full order/customer/
  reservation set is ever sent to the browser for client-side math.
- Batched queries only — no N+1:
  - customer list: 1 row query + 1 grouped revenue query;
  - customer report: customer rows + ≤5 batched aggregates;
  - reservation report: ~10 batched aggregates + 2 name lookups;
  - reservation export: 1 reservation query + 5 batched lookups.
- Reservation revenue obtains the scoped `orderIds` first, then one canonical query.
- Customer rows are capped at 5000; reservation export at 10000.

---

## 21. Revenue Consistency

- **Customer revenue == canonical Sales Report** for the same scope/date (`#22`):
  `totalSales 517000`, `grossSales 517000`, `totalOrders 16`, `items 0`, `totalRefund 30000`,
  `netSales 487000`, `AOV 32312.5` — **all match**.
- `computeCustomerRevenue` totals (`487000`) == `computeRefundRevenue.total.netSales` (`487000`).
- **Reservation revenue == canonical** (`#23`): the report's `reservationNetRevenue` equals an
  independent `computeRefundRevenue` call scoped to the reservation-linked order ids.
- **CANCELLED orders never book sales** (`status <> 'CANCELLED'` in every predicate);
  UNPAID/FAILED/EXPIRED are never revenue; refunds follow `computeRefundRevenue` exactly.
- The canonical `revenueWhere` / `computeRefundRevenue` bodies were **not modified**.

---

## 22. Runtime Verification

Harness `_p9b_verify.ts` (temp, deleted) + HTTP probes against `next start`. **31/31 PASS.**

| # | Check | Result |
|---|---|---|
| 1 | customer list | PASS (`GET /api/customers` 200) |
| 2 | password not present | PASS (list, detail, CSV) |
| 3 | customer detail | PASS |
| 4 | branch isolation (detail) | PASS (all=1/MAIN=1/OTHER=0) |
| 5 | tenant isolation | PASS (restaurant B → 403 / empty) |
| 6 | canonical revenue | PASS (== `computeRefundRevenue`) |
| 7 | cancelled order excluded | PASS |
| 8 | refund reflected | PASS (net < gross) |
| 9 | customer reservation metrics | PASS |
| 10 | customer CSV | PASS (no password) |
| 11 | reservation summary | PASS (5) |
| 12 | status breakdown | PASS (confirmed 2, completed 1) |
| 13 | cancellation | PASS (1 / 20%) |
| 14 | no-show | PASS (1 / 20%) |
| 15 | party size | PASS (guests 20, avg 4) |
| 16 | reservation revenue | PASS (30000) |
| 17 | cancelled reservation/order | PASS (excluded) |
| 18 | refund | PASS (net 0) |
| 19 | branch isolation | PASS (OTHER 0) |
| 20 | tenant isolation | PASS |
| 21 | reservation CSV | PASS (5 rows) |
| 22 | customer vs canonical Sales | PASS (all 7 metrics) |
| 23 | reservation vs canonical (orderIds) | PASS |
| 24 | DB counts before/after | PASS (identical) |
| 25 | no historical repair | PASS |
| 26 | `ORD-20260908-HCOK1L` | PASS (CANCELLED / PAID) |

Fixtures used only 5 temporary reservations (prefix `P9BTMP-`) linked to existing orders; **no order
or payment was created or modified**; all fixtures deleted in `finally`.

---

## 23. TypeScript Verification

`npx tsc --noEmit` → **0 errors** (exit 0). The single intermediate error
(`string | number | bigint` comparison) was fixed by numeric coercion; no suppressions, no `any`
casts introduced.

---

## 24. Build Verification

`npm run build` → **exit 0**. New routes compiled:
`○ /admin/reports/customers`, `○ /admin/reports/reservations`,
`ƒ /api/reports/customers`, `ƒ /api/reports/customers/export`,
`ƒ /api/reports/reservations`, `ƒ /api/reports/reservations/export`.
`next-env.d.ts` unchanged.

---

## 25. DB Before/After

Identical before and after the harness (fixtures created then removed):

```
orders 35, orderItems 1, payments 46, paymentTransactions 29,
refunds 2, refundItems 0, cancellationRequests 0, auditLogs 44,
customers 35, reservations 1
```

`git diff --check` → clean.

---

## 26. Historical Data Verification

`ORD-20260908-HCOK1L` (`cmtsb3l6y0005ljvmhabgejkr`) remains
`status = CANCELLED`, `paymentStatus = PAID`. No historical row was written, repaired, or
recalculated. The only writes performed were the temporary fixture reservations, all deleted.

---

## 27. Regression Assessment

- **Unmodified by design:** canonical `revenueWhere` / `computeRefundRevenue`, the Order engine, the
  Payment engine, the Reservation purchase/payment flow, Customer Auth, Promo, WhatsApp, Print Bill,
  Inventory, and the existing Sales Report semantics.
- `getCustomerReport` / `getReservationReport` were **added**; existing service methods were only
  extended additively.
- `customer.service.ts` changed return projections (C1/C2/C3) — verified to keep the existing admin
  customer page's fields. `totalSpent` changes value by design (C2).
- `getCustomer(id, ...)` gained an optional 3rd parameter (backward compatible).
- Sales Report numbers were re-checked and are unchanged.

---

## 28. Remaining Gaps

1. **C7 (guest vs registered classification) — NOT implemented.** The report exposes `email` per
   customer but no explicit guest/registered flag. It was optional and not required by C4.
2. **No-show has no dedicated timestamp.** Documented; the outcome is derived from `status`
   (a snapshot, not an event history). Adding `ReservationStatusHistory` was explicitly out of scope.
3. **Customer identity is restaurant-global (no `branchId`).** For the customer report,
   `totalCustomers` counts customers *created in the period* regardless of branch; branch scope
   applies to the order/reservation **metrics**. Documented.
4. **Reservation revenue date basis.** Reservation revenue uses the reservation period's date range
   as the canonical `Order.createdAt` bound; an order created before the period is not counted in
   that period's product revenue (canonical H4.5-B1 attribution). Documented.
5. **`getCustomerReport` is not paginated** (returns all scoped customers, capped at 5000) so the
   summary always matches the rows. Suitable for typical per-restaurant volumes.
6. **Customer detail page** (operational, C15) was not converted into a report; reservation metrics
   appear in the report, not in the operational customer detail.

---

## 29. Files Changed

**Modified (PHASE 9B only):**

| File | Change |
|---|---|
| `src/services/report/report.service.ts` | + `computeCustomerRevenue`, `resolveReservationDateRange`, `revenueScopeWhere` export, `getCustomerReport`, `getReservationReport`, `getReservationsForExport` |
| `src/services/customer/customer.service.ts` | C1 allow-list, C2 canonical spend, C3 branch filters |
| `src/app/api/customers/[id]/route.ts` | pass `authorizedBranches(ctx)` |
| `src/components/admin/reports/report-nav.tsx` | Customers + Reservations pills |
| `src/services/report.service.ts` | client wrapper types + `getCustomerReport`/`getReservationReport` |
| `src/services/customer.service.ts` | `Customer` type gains `email`/`isActive` |

**Added:**

| File |
|---|
| `src/app/api/reports/customers/route.ts` (64) |
| `src/app/api/reports/customers/export/route.ts` (104) |
| `src/app/api/reports/reservations/route.ts` (60) |
| `src/app/api/reports/reservations/export/route.ts` (103) |
| `src/app/admin/reports/customers/page.tsx` (362) |
| `src/app/admin/reports/reservations/page.tsx` (468) |

> Note: `git diff --stat` for `report.service.ts` includes the pre-existing (uncommitted) PHASE 8B
> working-tree changes; the PHASE 9B additions are the six symbols listed above.

---

## 30. Migration Assessment

**No migration is required.** The only potential migration flagged by the audit was **C14**,
`@@index([orderId])` on `reservation`.

Assessment of the reservation-revenue query:

1. Reservations are selected by `restaurantId` + `branchId` + `reservationDate`, all covered by the
   composite index `[restaurantId, branchId, reservationDate, status]` ⇒ an index range scan.
2. The linked orders are then matched by `o.id IN (orderIds)` — **`Order.id` is the primary key**,
   so the canonical `productRevenue`/`refundRevenue` subqueries use a PK lookup. The current data
   volume (1 reservation, 0 linked orders) executes instantly.
3. `Reservation.orderId` is never used as a **filter** predicate on `reservation` (only projected
   from already-index-scanned rows), so a `reservation.orderId` index would not be chosen by the
   planner for these queries.

Conclusion: the index is **not needed**; adding it would be a speculative, non-additive-benefit
change. Per the brief ("If Prisma/SQL query is still efficient without the index, do NOT migrate"),
**no migration was created**.

---

## 31. Final Verdict

**PHASE 9B is COMPLETE and verified.**

- All 12 required findings (C1–C6, C8–C13) implemented with minimal, engine-reusing changes.
- C14 assessed → **no migration** (PK-based queries; documented).
- C15 respected → date filters live only in the new reports; operational lists untouched.
- Canonical revenue engine reused, not reimplemented; `revenueWhere` / `computeRefundRevenue`
  untouched.
- `npx tsc --noEmit` = 0 errors; `npm run build` = exit 0; `git diff --check` = clean.
- Runtime: **31/31 PASS**; DB counts identical before/after; `ORD-20260908-HCOK1L` unchanged.
- **`HEAD` remains `d7f29ac`.** Nothing was committed, pushed, or deployed; no schema/DDL/DML/seed on
  historical data; no VPS/production touched.

**STOP.** Awaiting further instruction.
