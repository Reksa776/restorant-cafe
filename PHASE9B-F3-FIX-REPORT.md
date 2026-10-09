# PHASE 9B-F3 — BRANCH-SCOPED CUSTOMER REPORT FIX REPORT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Scope:** implement the approved policy for F3 in `getCustomerReport` only.
**Date:** 2026-10-09

---

## 1. Exact change and before/after query semantics

**File:** `src/services/report/report.service.ts` — **one expression**, `getCustomerReport` → `activityOrNew`
(now ~2727–2774). No other function or file changed.

### Before (all callers — restaurant-wide identity list)
```ts
const activityOrNew: Prisma.CustomerWhereInput = {
  OR: [
    { createdAt: { gte: range.start, lte: range.end } },              // period-created, NOT branch-scoped
    { orders: { some: { status: { not: "CANCELLED" }, createdAt: { gte, lte }, ...branchWhere } } },
  ],
};
```

### After (PHASE 9B-F3)
```ts
const activityOrNew: Prisma.CustomerWhereInput = branchFilters?.length
  ? {
      OR: [
        { AND: [                                                       // period-created AND in-branch order
            { createdAt: { gte: range.start, lte: range.end } },
            { orders: { some: { ...branchWhere } } },
          ] },
        { orders: { some: { status: { not: "CANCELLED" },             // in-period in-branch activity
                            createdAt: { gte: range.start, lte: range.end }, ...branchWhere } } },
      ],
    }
  : {
      OR: [                                                            // no branch filter → unchanged
        { createdAt: { gte: range.start, lte: range.end } },
        { orders: { some: { status: { not: "CANCELLED" }, createdAt: { gte, lte } } } },
      ],
    };
```

Semantics mapping to the approved policy:
- **“must belong to the selected branch”** → every listed customer must satisfy at least one branch: the
  period-created branch now `AND`s `orders.some({ ...branchWhere })` (any order in branch, any status, any date),
  and the activity branch keeps its `...branchWhere`.
- **“period-created may appear if they have at least one order in the branch, even outside the period”** →
  `{ createdAt ∈ period } AND { orders.some(branchWhere) }` (no order-date constraint on that `orders.some`).
- **“keep the existing report-period activity condition”** → the second OR-branch is byte-identical to before
  (`status <> 'CANCELLED'`, `createdAt ∈ period`, `...branchWhere`).
- **“no branch filter → preserve existing”** → the `:` branch is identical to the previous code.
- **Tenant unchanged:** still wrapped in `where: { restaurantId, AND: [activityOrNew, (search)] }`.

---

## 2. Verification commands and results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** (0 errors) |
| `npm run build` | **exit 0** |
| `git diff --check` | **clean** (exit 0) |

**Read-only verification** (temporary `_p9bf3fix.ts`, `SELECT`/report calls only, deleted after the run —
no fixtures written), **all checks PASS**:

- `[MAIN]` report ids **exactly equal** an independent SQL evaluation of the approved predicate (20 ids).
- `[PERUM-1]` equal (12 ids); `[MAIN+PERUM-1]` equal (32 ids).
- `[MAIN]` result ⊂ customers with any `MAIN` order; excludes the **15** customers with no `MAIN` order.
- All in-period `MAIN`-active customers remain included.
- `PERUM-1`-only customers (12) excluded from `[MAIN]`.
- Narrow/empty period `[MAIN]` → 0 (identity list collapses to in-period activity).
- No-branch caller unchanged: totalCustomers **35**, newCustomers **35**.
- Tenant isolation: `getCustomerReport("NOPE", …)` → totalCustomers **0**.
- Canonical totals unchanged: `computeRefundRevenue.netSales` **487000**;
  `computeCustomerRevenue.netSales` **487000**, `.refundRevenue` **30000**.

**In-memory predicate table** (covers the no-write sub-case “period-created customer with an out-of-period
branch order”):

| Case | old | new |
|---|---|---|
| period-created + out-of-period branch order | true | **true** ✅ included |
| period-created, no branch order | true | **false** ✅ excluded |
| in-period activity in branch (not period-created) | true | **true** ✅ |
| other-branch only | false | **false** ✅ |
| period-created + in-period branch activity | true | **true** ✅ |

---

## 3. Branch and tenant isolation evidence

- **Branch:** the report’s customer id set is now **set-equal to the independent SQL predicate** for `[MAIN]`,
  `[PERUM-1]`, and `[MAIN, PERUM-1]` — proving every listed identity has an in-branch order and period-created
  identities without one are excluded. The previously-widened rows (period-created, zero in-branch activity)
  are gone: `[MAIN]` 35 → 20, `[PERUM-1]` 35 → 12; `PERUM-1`-only customers do not appear in `[MAIN]`.
- **Tenant:** `restaurantId` scoping is unchanged (the `activityOrNew` is ANDed under the same
  `where: { restaurantId, … }`); a nonexistent restaurant returns 0 customers. No tenant widening.
- **No-branch callers:** unchanged restaurant-wide behaviour (35/35 in the wide period).

---

## 4. Impact on totalCustomers / newCustomers

Wide period (`2000-01-01 … 2100-01-01`; all customers are “period-created” so the change is maximal):

| Call | totalCustomers before → after | newCustomers before → after |
|---|---|---|
| `[MAIN]` | 35 → **20** | 35 → **20** |
| `[PERUM-1]` | 35 → **12** | 35 → **12** |
| `[MAIN, PERUM-1]` | 35 → **32** | 35 → **32** |
| no filter (restaurant-wide) | 35 → **35** (unchanged) | 35 → **35** (unchanged) |

Per-customer money fields (`orders`, `netSales`, `refund`, `aov`, reservations) are **not** affected — only the
set of customers listed changes, and only for branch-scoped callers. Zero-valued activity rows that previously
inflated the list are removed.

---

## 5. Regression risks

- **LOW.** The change is confined to the branch-scoped branch of `activityOrNew`; the no-branch path is
  byte-identical. No revenue/refund formula, reservation reporting, API response shape, or unrelated UI changed.
- `totalCustomers`/`newCustomers` for branch-scoped callers legitimately decrease (intended). Downstream UI
  cards/pagination adapt automatically (same response shape).
- Query cost is unchanged in order of magnitude (an added relation `EXISTS`); the customer cap
  (`CUSTOMER_REPORT_MAX_ROWS = 5000`) still applies.
- Tenant isolation preserved; the change **reduces** intra-tenant PII exposure (branch admins no longer see
  restaurant-wide new-customer identities).

---

## 6. Preservation of work and no database/schema changes

- **Preserved:** F1 credential fix, PHASE 9B, **F2** (reservation CSV scope), **F4** (shared revenue SQL
  fragments), **F5** (customer refund predicate) — untouched. F3 did not reimplement any of them.
- **No schema/migration/seed/data change:** `git diff -- prisma/` = 0 lines; migrations dir unchanged.
- **No persistent test fixtures written**; the read-only harness was deleted (`ls _p9b*.ts` → none).
- HEAD remains **`d7f29ac`**; **no commit, push, deploy, or VPS/production access**.

**Limitation:** the “period-created customer with an out-of-period **branch** order” sub-case has no row in the
current dataset (all orders fall inside the wide period), so it is verified via the in-memory predicate table and
the SQL predicate (which contains no order-date constraint on that `orders.some`), not via a live row. The
dataset is single-tenant and small (35 customers).
