# PHASE 9B-F4 — CANONICAL REVENUE CONSOLIDATION REPORT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Type:** implementation of finding **F4 only** (`PHASE9B-F2-F8-AUDIT.md`). Refactor — no behaviour change intended.
**Date:** 2026-10-09

---

## 1. Exact files / functions changed

**One file:** `src/services/report/report.service.ts`. All edits live there.

**Added — shared canonical revenue SQL (single source of truth):**

| Helper | Emits |
|---|---|
| `sqlAlias(name)` | identifier-safe alias (`Prisma.raw`, code-controlled literals only) |
| `paidRevenueSql(orderAlias)` | `(order.paymentStatus = 'PAID' OR EXISTS(payment pm REFUNDED for order))` |
| `revenueSetSql(orderAlias)` | `order.status <> 'CANCELLED' AND paidRevenueSql(...)` |
| `productRevenueSql(orderAlias)` | `(order.grandTotal − order.tax − order.serviceCharge)` |
| `refundRevenueSql(orderAlias, refundedAlias)` | `CASE WHEN order.grandTotal > 0 THEN LEAST(rf.refunded / order.grandTotal, 1) * productRevenueSql(...) ELSE 0 END` |
| `approvedRefundsSql(restaurantId, range?)` | tenant-scoped `APPROVED` refunds aggregated by `orderId`, optionally bounded by `approvedAt` |
| `aliasBranchSql(alias, branchFilters)` | `AND alias.branchId IN (...)` (order/refund alias) |

**Rebuilt from the shared helpers (no engine change):**

| Function | What changed |
|---|---|
| `computeRefundRevenue` (canonical engine) | product/refund halves now compose `revenueSetSql`, `productRevenueSql`, `refundRevenueSql`, `approvedRefundsSql`, `aliasBranchSql`. Removed the two inline copies of the predicate and the inline refund subquery/math. |
| `computeCustomerRevenue` | same fragments; removed its `refundDateFragment` (now inside `approvedRefundsSql`) and its local branch fragment. |
| `orderFragment` (module helper, currently **unused**) | now composes `revenueSetSql("\`order\`")` instead of an inline predicate copy. |
| `getCustomerReport` → `activityRows` | the revenue-set predicate was inlined **4×**; each `CASE WHEN <predicate>` now composes `paidRevenueSql("o")`. |
| `getReservationReport` → funnel `paid` subquery | inner predicate now composes `revenueSetSql("o")`. |
| `getReservationsForExport` | the JavaScript revenue re-implementation was replaced by **one** per-order raw query built from the same fragments; the order lookup was trimmed to `{ id, paymentStatus }` (only the CSV column + existence are read there). The F2 shared-`orderId` single attribution stays in JS. |

Net effect: the predicate/math now exist **once** (in the helpers). No new engine, no second source of truth.

---

## 2. Consolidated vs intentionally separate

**Consolidated (equivalent semantics):**

- The revenue-set predicate (`status <> 'CANCELLED' AND (paymentStatus = 'PAID' OR EXISTS payment REFUNDED)`) — previously 5 inline copies (canonical ×2, `computeCustomerRevenue` ×2, activity ×4, funnel ×1, export JS ×1).
- The product-revenue expression `grandTotal − tax − serviceCharge`.
- The refund math (`LEAST(refunded/grandTotal,1) × product`, capped).
- The `APPROVED`-refunds-grouped-by-order subquery (tenant + optional `approvedAt` range).
- The order branch fragment (`branchId IN (...)`).

**Intentionally left separate (documented, not forced into a misleading abstraction):**

1. **`computeCustomerRevenue` refund half keeps its original `status <> 'CANCELLED'`-only filter** (it does **not** apply `paidRevenueSql`, unlike `computeRefundRevenue`'s refund half). This was the existing semantics; the task forbids changing payment-status/cancellation semantics without evidence/approval, so only the **math** (`refundRevenueSql`) is shared here. An in-code comment marks this. Consequence: if an `APPROVED` refund ever existed on an order that is neither `PAID` nor has a `REFUNDED` payment, the two engines would differ. No such row exists today (audit: numerically equal).
2. **`orderFragment`** retains its extra filters (`orderType`, `paymentMethod`) and its unaliased `\`order\`` reference; it is currently unused (grep-verified) and not part of the F4 9B set, but was still folded onto `revenueSetSql` to remove its predicate copy.
3. **`getReservationsForExport`'s per-row shape** (batched Prisma lookups, per-reservation rows, shared-`orderId` single attribution) is preserved. Only its predicate/math moved to the shared SQL; the grouping/output shape genuinely differs from the aggregate reports, so it is not merged wholesale.

---

## 3. Proof the F2 behaviour remains intact

F2 requires: order **branch** scope, refund **`approvedAt`** range bound, product **`createdAt`** range bound, and shared-`orderId` single attribution. All four are preserved:

- `aliasBranchSql("o", branchFilters)` is applied to both halves of the export's per-order query (and to the canonical engines).
- `approvedRefundsSql(restaurantId, range)` embeds `AND r.approvedAt >= start AND <= end`.
- Product half embeds `AND o.createdAt >= range.start AND <= range.end`.
- `revenueAttributed` still attributes a shared order once (first row).

Runtime proof (isolated fixtures, below): cross-branch row `= 0`, out-of-period refund row `= 50000` (refund excluded), partial in-range refund row `= 60000`, shared order `[80000, 0]`, and **Σ CSV.revenue (190000) == report.summary.reservationNetRevenue (190000)**.

---

## 4. Before / after revenue comparison and rounding

### Real historical data (read-only; the strongest before/after evidence)
The pre-refactor canonical values are the constants recorded in the F4 audit. The refactored code reproduces them exactly:

| Metric (restaurant A, all-time) | Pre-refactor (audit) | Post-refactor | Δ |
|---|---|---|---|
| `computeRefundRevenue.total.productRevenue` | 517000 | 517000 | 0 |
| `computeRefundRevenue.total.refundRevenue` | 30000 | 30000 | 0 |
| `computeRefundRevenue.total.netSales` | 487000 | 487000 | 0 |
| `computeCustomerRevenue.total.productRevenue` | 517000 | 517000 | 0 |
| `computeCustomerRevenue.total.refundRevenue` | 30000 | 30000 | 0 |
| `computeCustomerRevenue.total.netSales` | 487000 | 487000 | 0 |

### Isolated fixtures (date `2099-02-10`, branch `[MAIN]`, unique markers, cleaned up)

| Case | Report | Export |
|---|---|---|
| E paid 100000, partial refund 40000 in range | product 100000 / refund 40000 | `60000` |
| F unpaid 50000 | excluded | `0` |
| G cancelled (paymentStatus PAID) 30000 | excluded | `0` |
| H paymentStatus FAILED 20000 | excluded | `0` |
| I cross-branch order 70000 (`MAIN` reservation) | excluded | `0` |
| J shared order 80000 → 2 reservations | counted once | `[80000, 0]` |
| K refund approved **outside** period | refund excluded | `50000` |
| **Totals** | `reservationRevenue 230000`, `reservationRefund 40000`, `reservationNetRevenue 190000` | **Σ `= 190000`** |

Cross-engine equality on the same order set/range: `computeCustomerRevenue.total` = `{ product 230000, refund 40000, net 190000, orderCount 3 }`; `getCustomerReport` row = `{ orders 3, activityOrders 5, grossSales 230000, totalSales 230000, refund 40000, netSales 190000 }`; funnel `paid = 5`.

### Rounding
- Refund math unchanged: `LEAST(refunded/grandTotal, 1) × product` (the shared `refundRevenueSql` renders the identical expression).
- Report buckets: `netSales = round(product − refund)` per branch/customer bucket, then summed — unchanged.
- Export: per-order `Math.round(x * 100) / 100` (the export's pre-existing per-order rounding), unchanged.

---

## 5. Tenant / branch / API / CSV impact

- **API:** none. No route, request/response shape, or CSV column changed. `getReservationReport`, `getCustomerReport`, and `getReservationsForExport` return the same objects.
- **Tenant:** every query keeps an explicit `restaurantId` (now centralized in `approvedRefundsSql` and present in each `order`/`reservation` WHERE). Runtime tenant-isolation checks return `0` for a non-existent restaurant id.
- **Branch:** scope preserved. The canonical engines and the export apply `aliasBranchSql`; the reservation/funnel/date queries apply their existing branch SQL. The funnel `paid` subquery does **not** branch-scope the linked order (pre-existing behaviour, preserved — a cross-branch order still counts as "paid" in the funnel while contributing 0 revenue; test expected `5`).
- **CSV:** same header/columns; revenue values now come from the shared canonical SQL. A shared order is still emitted once (F2).

---

## 6. TypeScript / build / diff-check results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **exit 0** (0 errors) |
| Build | `npm run build` | **exit 0** |
| Whitespace | `git diff --check` | **clean** (exit 0) |

Verified **after** the final source edit (the temp harness was removed before the final run).

---

## 7. Migration / data impact

- **No migration, no schema change, no seed change, no historical-data change.**
- `git diff -- prisma/` → **0 lines**.
- The verification harness (`_p9bf4verify.ts`) created only temporary fixtures on a far-future date with unique markers and deleted them in a `finally` block; `orders` count returned to its baseline (`before=35 after=35`). No historical row was modified.

---

## 8. Remaining limitations & regression risks

- **Live-data reproduction:** the live dataset still has 0 reservation-linked orders, so the reservation-specific paths are inert on real data. All fixture scenarios PASS; the real-data evidence is the canonical-constant equality (§4).
- **Before/after method:** the "before" values are the audit's recorded canonical constants plus the pre-refactor formula/rounding (Git had uncommitted PHASE 9B changes, so a stashed pre-refactor binary was not built). The refactor is a pure composition change; the equality check guards it.
- **Preserved semantic difference (§2.1):** `computeCustomerRevenue`'s refund half remains broader than `computeRefundRevenue`'s (no paid predicate). This is intentional and unchanged; it could diverge only on data that does not exist today. Left for a separate, evidence-backed decision.
- **`orderFragment`** is dead code with its own extra filters; it was folded onto `revenueSetSql` but not removed.
- **Regression risk:** LOW. Changes are confined to `report.service.ts`; the SQL emitted is equivalent (verified by the canonical equality and the fixture matrix). Any residual risk is limited to a typo in a fragment, which the passing build + identical canonical totals make very unlikely.

---

## 9. Git status / no commit

- HEAD remains **`d7f29ac`** — unchanged.
- `src/services/report/report.service.ts` modified (uncommitted, alongside the pre-existing PHASE 9B / F1 / F2 working-tree changes). No other file was changed by F4.
- `_p9bf4verify.ts` temp harness **deleted** (`ls _p9b*.ts` → none).
- **No `git add`, no commit, no push, no deploy, no VPS/production action.**
- F1 credential fix, PHASE 9B, and the F2 fix are preserved; F3 and F5–F8 were **not** implemented.
