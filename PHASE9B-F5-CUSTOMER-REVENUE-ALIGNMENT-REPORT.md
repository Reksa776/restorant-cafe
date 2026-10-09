# PHASE 9B-F5 — CUSTOMER REVENUE PREDICATE ALIGNMENT REPORT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Scope:** approved fix for the confirmed divergence in `computeCustomerRevenue` only (Issue A of
`PHASE9B-POST-F4-SEMANTIC-REVIEW.md`).
**Date:** 2026-10-09

---

## 1. Exact code change

**File:** `src/services/report/report.service.ts` — **one function bit**, inside `computeCustomerRevenue`
(line 379). The **refund half** of the `UNION ALL` now applies the canonical `revenueSetSql("o")` predicate.

```diff
       UNION ALL
       SELECT o.`customerId` AS customerId,
              0 AS orderCount,
              0 AS productRevenue,
              ${refundRevenueSql("o", "rf")} AS refundRevenue
-      -- F4 — this refund half intentionally keeps its original
-      -- (status <> CANCELLED)-only filter (no paid predicate), unlike
-      -- computeRefundRevenue; only the shared math is consolidated here.
+      -- PHASE 9B-F5 — the refund half now applies the SAME canonical
+      -- revenue-set predicate as computeRefundRevenue (non-cancelled AND
+      -- paid-or-collected-then-refunded), so an APPROVED refund on an order
+      -- outside the revenue set no longer reduces customer net revenue.
       FROM (${approvedRefundsSql(scope.restaurantId, scope.range ?? null)}) rf
       JOIN `order` o ON o.`id` = rf.`orderId`
       WHERE o.`restaurantId` = ${scope.restaurantId}
-        AND o.`status` <> 'CANCELLED'
+        AND ${revenueSetSql("o")}
         ${branchFragmentSql}
         ${customerFragmentSql}
         ${extraOrderFilter}
```

Docblock of `computeCustomerRevenue` updated to state the refund half is now on the revenue set.
No other change. Nothing else in the file was edited by F5.

**Preserved filters (unchanged):** `o.restaurantId = scope.restaurantId` (tenant), `branchFragmentSql`
(`o.branchId IN branchFilters`), `customerFragmentSql` (`o.customerId IN customerIds`),
`extraOrderFilter`, the `approvedRefundsSql(scope.restaurantId, scope.range ?? null)` subquery
(APPROVED status + tenant + optional `approvedAt` range), and the `refundRevenueSql` math.

---

## 2. Before / after predicate

`revenueSetSql("o")` is the shared canonical fragment (used verbatim by `computeRefundRevenue`):

```
o.`status` <> 'CANCELLED' AND (
  o.`paymentStatus` = 'PAID'
  OR EXISTS (SELECT 1 FROM `payment` pm WHERE pm.`orderId` = o.`id` AND pm.`status` = 'REFUNDED')
)
```

| | Refund-half `WHERE` on the joined order |
|---|---|
| **Before (F4 state)** | `o.restaurantId = … AND o.status <> 'CANCELLED'` |
| **After (F5)** | `o.restaurantId = … AND revenueSetSql("o")` = `o.status <> 'CANCELLED' AND (o.paymentStatus = 'PAID' OR EXISTS REFUNDED payment)` |

Net difference: the refund half now additionally requires the order to be on the revenue set. Because the
predicate subsumes `status <> 'CANCELLED'`, the two clauses were merged (no duplication). The product half was
already on `revenueSetSql`, so both halves now use the identical predicate — matching `computeRefundRevenue`.

---

## 3. Verification commands and results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** (0 errors) |
| `npm run build` | **exit 0** |
| `git diff --check` | **clean** (exit 0) |

**Read-only verification** (temporary `_p9bf5verify.ts`, `SELECT`/`$queryRaw` only, deleted after the run —
**no persistent writes, no fixtures created**), 17/17 PASS:

Current-data canonical totals (must be unchanged):
- `computeRefundRevenue` → product **517000**, refund **30000**, net **487000** ✅
- `computeCustomerRevenue` → product **517000**, refund **30000**, net **487000** ✅

Branch / tenant scoping intact:
- nonexistent restaurant → net **0**; nonexistent branch filter → net **0**
- all-time net 487000 = MAIN 120000 + PERUM-1 367000 (each ≤ all-time) ✅

**Synthetic predicate table** (constants only — a read-only equivalent demonstrating the fix's exact
inclusion logic, since writing a live off-set fixture is disallowed by the guardrails):

| Order | `old_inc` | `new_inc` | refund_old | refund_new |
|---|---|---|---|---|
| paid | 1 | 1 | 40000 | 40000 |
| unpaid (no REFUNDED payment) | 1 | **0** | 50000 | **0** ← the fixed case |
| unpaid + REFUNDED payment | 1 | 1 | 60000 | 60000 |
| cancelled | 0 | 0 | 0 | 0 |

The `unpaid` row is the semantic divergence: previously the refund reduced customer net revenue; after F5 it
is excluded, exactly as `computeRefundRevenue` does. Rows that were already correct are unchanged.

**End-to-end fixture note:** a written fixture (order `UNPAID` with an APPROVED refund) was **not** created,
per the “do not write to the persistent database” guardrail. The synthetic table above establishes the
category but does not push values through the live `computeCustomerRevenue` read path; the current dataset
contains **0** such rows (semantic review evidence), so the live totals are the authoritative before/after
check and they are identical.

---

## 4. Current-data impact

- **Zero numeric change.** Current dataset: 0 approved refunds on orders outside the revenue set (the single
  APPROVED refund is on a revenue-set order). All customer-report and operational `totalSpent` figures are
  unchanged (product 517000 / refund 30000 / net 487000).
- The change only affects a hypothetical/legacy row: an order with an APPROVED refund that is neither `PAID`
  nor has a `REFUNDED` payment; for such a row the customer refund/net is now correctly not reduced.
- UI/API contract, response shapes, and CSV columns unchanged.

---

## 5. Regression risks

- **LOW.** The refund half now matches the canonical engine it was documented to mirror; the added predicate
  is strictly narrowing and unreachable on current data.
- Only `computeCustomerRevenue` changed; `computeRefundRevenue`, the reservation funnel `paid` predicate, the
  order/payment/refund workflows, model, and schema are untouched.
- Behaviour is guarded by the canonical-equality check (customer totals == canonical refund totals), which
  still holds (517000/30000/487000).

---

## 6. Preservation of unrelated changes and existing work

- **F1** credential fix, **PHASE 9B**, **F2** (reservation CSV scope), and **F4** (shared canonical SQL
  fragments) are preserved and unmodified by F5.
- F5 touches only the `computeCustomerRevenue` refund half (+ its docblock); the shared helpers and every other
  query are unchanged. Diff is minimal.
- **No schema/migration/seed change** (`git diff -- prisma/` = 0 lines); **no database reset**; **no historical
  data modification**; no persistent fixture written; temp harness deleted (`ls _p9b*.ts` → none).
- HEAD remains **`d7f29ac`**; **no commit, push, deploy, or VPS/production access**.
