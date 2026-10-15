# STEP 2C.3A — Reporting Predicate Consistency Audit (A-9 / A-11)

> **Concise summary derived from the legacy archive** `ACCOUNTING-INTEGRATION-TEST-PLAN.md` §28
> (STEP 2C.3A). The archive is the authoritative audit record; this file is the per-phase report
> required by the new reporting policy. **No file under `src/`, `prisma/` or `tests/` was changed
> by that audit.**

**Status:** ✅ COMPLETE (audit only)
**Mode:** strict audit — no production edit, no test edit, no database write, no migration/schema edit.

## 1. What was audited

A-9 (`busiestHours`) and A-11 (`getProductReport`) were known to disagree with the canonical
revenue predicate. The audit traced the predicate, every consumer of it, the Order↔Payment status
relationship, refund/cancellation handling, tenant/branch isolation, date attribution and the
existing regression coverage — and searched the whole reporting domain for further instances.

## 2. Canonical rule (unchanged, not up for negotiation)

```
revenue set = restaurantId ∧ branch scope ∧ status <> 'CANCELLED'
              ∧ ( order.paymentStatus = 'PAID'
                  OR EXISTS payment p: p.orderId = order.id AND p.status = 'REFUNDED' )
              ∧ order.createdAt ∈ range                     -- gross side
refund side = refund.status = 'APPROVED' ∧ refund.approvedAt ∈ range,
              over the DATE-FREE revenue set
```

Single source of truth: `revenueWhere` (`report.service.ts:199`), `revenueScopeWhere` (`:220`),
and the SQL twin `revenueSetSql` (`:545`) built on `paidRevenueSql` (`:532`).

**Why the `OR EXISTS REFUNDED` half matters:** on refund approval the service marks the collected
payments `REFUNDED` and resets the order mirror to `UNPAID` once the net collected amount reaches
zero (`approval.service.ts:502–528`). A fully refunded order therefore has
`Order.paymentStatus = 'UNPAID'` **plus** a `REFUNDED` payment — it must stay in the revenue set so
its revenue is *reversed* (net 0), never silently dropped.

## 3. Findings

| ID | Site | Defect |
|----|------|--------|
| **A-9** | `getSalesReport` → `busiestHours` raw SQL, `report.service.ts:1354` | filters `paymentStatus = 'PAID'` only, while its sibling `dailySeries` (`:1365`) inlines the canonical predicate → the two sub-reports of one response disagree |
| **A-11** | `getProductReport` product rows, `:1798` | same PAID-only filter, while `soldWhere` (`:1758`, canonical) drives `unsoldProducts` (`:1840`) and `soldOrderCount` (`:1852`) in the same payload |
| **A-12 (NEW)** | `getMultiOutletReport` per-branch order-type breakdown, `:2479` | same PAID-only filter, while the branch totals beside it use the canonical set → `orderType[*].amount` cannot sum to that branch's `totalSales` |

**A-11 consequence corrected vs the older archive wording:** the failure mode is not “listed as
unsold”. A product whose only sales sit on a fully-refunded order is excluded from `products`
(PAID-only rows) **and** excluded from `unsoldProducts` (canonical `soldWhere` says it *was* sold)
— it disappears from **both** lists, while `summary.orderCount` still counts the order.

**Consumer inventory:** 29 consumers classified — 3 defective (above), 6 correct-but-hand-rolled
duplicates of the canonical predicate (`report.service.ts` daily series + three multi-outlet
queries, `profitability.service.ts` ×2, `menu-engineering.service.ts` ×2), and 20 intentionally
different bases (cashbook money-movement dates, payment/shift ledgers, order-listing export,
procurement/stock). No other consumer redefines revenue.

## 4. Exposure

| Defect | Reachable via |
|--------|---------------|
| A-9 | `GET /api/reports/sales` (JSON/UI hourly chart). The sales CSV does **not** carry it (it uses the order-listing export). |
| A-11 | `GET /api/reports/products` **and** `/export` (the understated product table is downloaded). |
| A-12 | `GET /api/reports/multi-outlet` **and** `/export` (order-type counts/amounts sit in the same CSV row as `totalSales`). |

## 5. Verdict handed to 2C.3B

- Root cause in all three cases: **predicate drift** — a raw fragment written against
  `paymentStatus = 'PAID'` that was never migrated to `revenueSetSql`. The business rule itself is
  correct and frozen.
- Minimal correction: **3 lines in one file** (`report.service.ts:1354`, `:1798`, `:2479`) plus one
  stale comment in `src/app/api/reports/products/export/route.ts` (it documented the wrong rule).
- No schema, migration, data, security or tenant-isolation impact.
- Required regression: the 10-case matrix + 6 cross-view invariants (archive §28.7).

**Limitations of the audit (unchanged):** it was static — no test or query was executed — so the
A-9 symptom and all earlier baselines were cited as *previously reported* evidence, not re-verified.
