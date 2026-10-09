# PHASE 9B-F2 — RESERVATION CSV SCOPE FIX

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Type:** implementation of finding **F2 only** (from `PHASE9B-F2-F8-AUDIT.md`). No commit/push/deploy.
**Date:** 2026-10-09

---

## 1. Root cause

`getReservationsForExport` (the per-reservation CSV export) re-implements the
reservation revenue math in **JavaScript** instead of going through the canonical
scope used by `getReservationReport` → `computeRefundRevenue`. As a result the
exported CSV disagreed with the on-screen report in three ways:

1. **Order lookup was not branch-scoped.** The report feeds its linked order ids
   into `computeRefundRevenue`, which applies `o.branchId IN (branchFilters)`;
   the export order query was
   `prisma.order.findMany({ where: { id: { in: orderIds }, restaurantId } })`
   with **no `branchId` predicate**. A `MAIN` reservation linked to a `PERUM-1`
   order therefore contributed revenue in the CSV but `0` in the report.
2. **Refund lookup was not date-bounded.**
   `prisma.refund.groupBy({ …, status: "APPROVED" })` summed **all-time**
   approving refunds, while the report bounds refunds by
   `rf.approvedAt BETWEEN start AND end` (canonical H4.5-B1 — refund impact is
   attributed to the approval date). A refund approved outside the report period
   still reduced the exported row but was not counted by the report.
3. **Shared `orderId` was counted once per row.** The report collects the
   distinct linked `orderId`s and feeds them to `computeRefundRevenue` as a SQL
   `id IN (orderIds)` set — one order's revenue is counted **once**. The export
   printed the same order's full revenue on **every** reservation that
   referenced it, so the CSV revenue-column sum duplicated a shared order and no
   longer equalled the report's `reservationRevenue`.

Additionally, the export's per-order product basis was not bounded by
`Order.createdAt` within the report range, unlike `computeRefundRevenue`
(product revenue attributed by order creation). This is the same class of scope
drift as (1)/(2) and is required for the CSV total to equal the report's
definition, so it was aligned too (scope only — no formula change).

---

## 2. File / function changed

**Single file, single function:**

- `src/services/report/report.service.ts` → `ReportService.getReservationsForExport` (was line 3260).

Changes (all inside that function; nothing else in the service was touched):

| # | Location (in `getReservationsForExport`) | Change |
|---|---|---|
| 1 | order `findMany` `where` | added `...(branchFilters?.length ? { branchId: { in: branchFilters } } : {})` — **branch scope** (only when a branch filter is provided), keeping `restaurantId` tenant scope |
| 2 | order `findMany` `select` | added `createdAt: true` to support product attribution |
| 3 | refund `groupBy` `where` | added `approvedAt: { gte: range.start, lte: range.end }` — **refund period bound**, identical to `getReservationReport`'s canonical range |
| 4 | per-row JS math | product revenue only when `order.createdAt` is within `[range.start, range.end]`; refund share still `min(refunded/grandTotal,1) × product` (unchanged formula) |
| 5 | per-row loop | added `revenueAttributed` set — **shared-`orderId` dedupe** (see §3) |
| 6 | function docblock | documented the aligned scope + shared-order semantics |

Not changed: payment-status/revenue-set predicate
(`status !== "CANCELLED" && (paymentStatus === "PAID" || payments.length > 0)`),
the refund share formula, the CSV column set/order, tenant handling, and the
`reservation.findMany` base query. No canonical formula or engine was modified.

---

## 3. CSV behaviour for a shared `orderId`

**Decision: an order's revenue is emitted ONCE — on the first reservation that
references it in the deterministic row order (`reservationDate asc`,
`startMinutes asc`) — and `0` on the remaining rows.**

Rationale:
- `getReservationReport` collects the **distinct** linked `orderId`s and feeds
  them to `computeRefundRevenue` as a set, so the report counts each order once.
  Emitting the same order on every linked row would break the invariant
  `Σ CSV.revenue == report.summary.reservationNetRevenue`.
- The chosen behaviour keeps **every reservation row** (no row is dropped) and
  emits the order's value **in full exactly once** (no order value is altered or
  silently zeroed). Only the attribution — which row carries the shared order's
  revenue — is made explicit and deterministic.
- Implemented via `const revenueAttributed = new Set<string>()`; a row whose
  `orderId` has already been attributed receives `revenue = 0`.

Verified in fixture scenario C: one `MAIN` order (net `80000`) linked to two
`MAIN` reservations → export rows `80000` + `0` (sum `80000`), matching the
report's single count.

---

## 4. Verification results & test limitations

### Static checks (all green)
- `npx tsc --noEmit` → **exit 0** (0 errors).
- `npm run build` → **exit 0**.
- `git diff --check` → **clean** (exit 0).

### Runtime verification — isolated fixtures (`PASS`)
Because the local dataset has **0 reservations linked to an order** (see §4
limitation), the scenarios were reproduced with a **temporary isolated fixture
harness** (`_p9bf2verify.ts`, far-future date `2099-01-10` so no historical row
falls in range; unique `P9BF2-<ts>` markers; cleanup in a `finally` block). The
harness was **deleted** after the run; DB counts returned to their exact
baseline (orders 35, reservations 1, refunds 2, customers 35 — before **and**
after).

Scenario outcomes (branch filter `[MAIN]`, period `2099-01-10`):

| Scenario | Fixture | Export (after fix) | Report | Match |
|---|---|---|---|---|
| A — cross-branch `orderId` | `MAIN` reservation → `PERUM-1` order (net 100000) | `0` | excluded (`0`) | ✅ |
| B — refund approved **outside** period | `MAIN` order (50000) + refund 50000 approved `2098-12-01` | `50000` | refund excluded | ✅ |
| C — shared `orderId` | one `MAIN` order (80000) → two reservations | `80000` + `0` (sum 80000) | counted once (80000) | ✅ |
| D — refund approved **inside** period | `MAIN` order (60000) + refund 60000 approved in-range | `0` | net `0` | ✅ |

- Report summary: `productRevenue 190000`, `refundRevenue 60000`, `netSales 130000`.
- Export CSV revenue SUM: **130000** → `Σ CSV.revenue === report.summary.reservationNetRevenue` → **PASS**.
- Tenant scope retained: order lookup still `restaurantId = session restaurant`; the customer/branch/table lookups are unchanged and id-scoped.
- Counterfactual (pre-fix code path): A → 100000, B → 0 (all-time refund), C → 160000, D → 0 → sum **260000 ≠ 130000**. This shows each of the three defects was real and is now fixed.

### Limitations (stated honestly)
- On the **current production-like dataset** the finding remains **NOT
  REPRODUCED** (0 linked reservations, 0 cross-branch links, 0 shared
  `orderId`). The PASS above is from **isolated fixtures**, not from live data.
- The harness exercised the reservation revenue path only; it did not add
  permanent tests (no test framework harness was introduced for this task).

---

## 5. Impact

- **API:** none. `GET /api/reports/reservations/export` route, response contract,
  CSV columns, and `buildCsv` usage are unchanged. Only the `revenue` **values**
  of linked reservations can change (now matching the report).
- **Tenant:** unchanged — `restaurantId` still scopes the order lookup
  (and the reservation base query). No cross-tenant read introduced.
- **Branch:** the order lookup now honours the caller's `branchFilters`,
  matching `getReservationReport`. A branch-scoped caller no longer sees revenue
  from an order in another branch. When no branch filter is supplied the order
  lookup is exactly as before.
- **Revenue:** unchanged formula, unchanged payment-status/revenue-set predicate.
  The refund share is now period-bounded (by `approvedAt`) and product is
  period-bounded (by `createdAt`), both identical to
  `computeRefundRevenue` as invoked by the report. The export's revenue column
  now reconciles with `report.summary.reservationRevenue / reservationRefund /
  reservationNetRevenue`.
- **CSV:** same header/rows; a shared order's revenue appears once instead of on
  every linked row. No row is dropped; no order value is altered.

---

## 6. Migration / data change

- **No migration. No schema change. No seed change. No data change.**
- `git diff --stat -- prisma/` is **empty** (migrations dir unchanged, ends at
  `20260920_add_floor_layout`). The added `Reservation.orderId` scalar has no
  relation/index today; F2 needs none.
- No historical record was read-modified by the fix; the verification fixtures
  were created and deleted within the harness, leaving counts identical.

---

## 7. F1 and PHASE 9B preserved

- **F1 security fix preserved and untouched:** `src/services/order/order.service.ts`
  and `src/services/payment/payment.service.ts` still select
  `customer: { select: { id, name, phone } }` — customer `password` /
  `whatsappId` are never serialized.
- **PHASE 9B preserved:** all PHASE 9B changes remain in the working tree
  (`computeCustomerRevenue`, `getCustomerReport`, `getReservationReport`,
  `getReservationsForExport`, the four report routes, the two report pages, and
  the navigation entries). F2 modified only the revenue scope/math inside
  `getReservationsForExport`; no other PHASE 9B behaviour was changed.
- F3–F8 were **not** implemented (out of scope for this task).

---

## 8. Git status / no commit

- HEAD is **`d7f29ac`** — unchanged.
- `src/services/report/report.service.ts` is modified (uncommitted, alongside the
  pre-existing PHASE 9B working-tree changes).
- No `git add`, no `git commit`, no `git push`, no deploy, no VPS/production
  action was performed. The temporary `_p9bf2verify.ts` harness was deleted
  (`ls _p9b*.ts` → none).
