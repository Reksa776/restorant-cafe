# M1 — IMPLEMENTATION REPORT (Menu Engineering Net-Sales Basis)

**Repo:** `/home/reksa/restorant-cafe`
**Scope:** M1 only, per `M1-SOLUTION-PROPOSAL.md` **Opsi 3** (reviewer APPROVED).
**Baseline HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef`
**Status:** implemented + verified. **STOP for review.**

---

## 1. Contract implemented

`MenuEngineeringSummary` (additive — old fields/number semantics unchanged):

| Field | Meaning |
|---|---|
| `totalNetSales` | **unchanged**: Σ per-product `netSales` where `qtySold > 0` → basis **PRODUCT** (item-attributed). |
| `netSalesBasis` | new literal `"PRODUCT"` — explicit contract for `totalNetSales`. |
| `netSalesHeaderBasis` | new: order/header-basis Net Sales, copied from the Profitabilitas summary already fetched (`summary.netSales`). Never attributed to a product. |
| `revenueWithoutItems` | new: `{ orders, headerValue }` D1 disclosure, copied from Profitabilitas (no new query). |
| `historicalCogs` / `grossProfit` / `grossMarginPct` / `productCount` / `coverageComplete` | **unchanged formulas and values**. |

- Header reference + disclosure come from `firstProfitability.summary`, produced by the **same** `fetchAllProfitability(restaurantId, range, branchFilters)` call ME already made → **no query added**, and tenant (`ctx.restaurantId`) + branch (`branchFilters`) scope is **identical to the source report**.
- Profit stays `null` (unknown) whenever COGS coverage is incomplete; nothing was backfilled or re-attributed.

---

## 2. Files changed

**Tracked (4) — `git diff --stat`:**

```
 src/app/admin/menu-engineering/page.tsx            | 46 ++++++++++++++++++++-
 src/app/api/reports/menu-engineering/export/route.ts | 31 +++++++++++++-
 src/services/menu-engineering/menu-engineering.service.ts | 48 ++++++----------------
 src/services/menu-engineering/menu-engineering.types.ts | 26 ++++++++++++
 4 files changed, 112 insertions(+), 39 deletions(-)
```

**New untracked (2):**
- `src/services/menu-engineering/menu-engineering.summary.ts` — pure, DB-free `buildMenuEngineeringSummary()` (extracted from the removed private `buildSummary`; identical arithmetic).
- `src/services/menu-engineering/menu-engineering.summary.unit.test.ts` — 6 unit tests.

### What changed

1. **`menu-engineering.types.ts`** — added `netSalesBasis: "PRODUCT"`, `netSalesHeaderBasis: number`, `revenueWithoutItems: { orders; headerValue }`.
2. **`menu-engineering.summary.ts` (new)** — deterministic builder: product total + header reference + disclosure, coverage via existing `isCoverageComplete` (D1). Imports only `../../lib/money` and `../profitability/coverage` (pure) → unit-testable without Prisma/DB.
3. **`menu-engineering.service.ts`** — `buildSummary(...)` replaced by `buildMenuEngineeringSummary(rows, firstProfitability.summary)`; private method removed; no query change.
4. **`admin/menu-engineering/page.tsx`**
   - Card relabelled **"Total Net Sales (Produk)"**.
   - Separate **"Net Sales (Basis Order) — referensi"** panel showing `netSalesHeaderBasis`, with basis explanation.
   - Disclosure line when `revenueWithoutItems.orders > 0` (orders / header value, profit unverifiable).
   - **F7 guard fixed**: banner now triggers on `totalOrderItems === 0 && (totalNetSales > 0 || revenueWithoutItems.orders > 0)` — no longer blind to the `totalNetSales = 0` incident.
5. **`api/reports/menu-engineering/export/route.ts`** — per-product column kept on item basis, header renamed `"Net Sales"` → `"Net Sales (Produk)"`; appended a disclosure block (basis definition, header basis, orders/header value without items, coverage + profit-verifiable flags). Flat product-row format preserved.

**No** revenue/refund/COGS/grossProfit/netProfit/coverage formula changed. No migration, no dependency, no schema change. No M2/M3/F5/F6 work; only the M1-owned F7 warning guard.

---

## 3. Tests — actual results

Command runner: `npx tsx --test <file>` (repo convention). Exit codes captured via `PIPESTATUS`.

| Check | Result | Exit |
|---|---|---|
| `npx tsx --test .../menu-engineering.summary.unit.test.ts` | **6 pass / 0 fail** | 0 |
| `npx tsx --test .../menu-engineering.classify.unit.test.ts .../coverage.unit.test.ts` | **38 pass / 0 fail** | 0 |
| `npx tsc --noEmit` | clean, no errors | 0 |
| `npm run build` | compiled successfully | 0 |
| `git diff --check` | no whitespace/conflict errors | 0 |

New tests cover:
- product basis retained (`netSalesBasis === "PRODUCT"`, Σ rows);
- header reference passed through and **never** overwriting the product total;
- `revenueWithoutItems` forwarded exactly;
- incident period: product total `0`, header reference visible, `coverageComplete=false`, `grossProfit=null`;
- **regression**: normal period with `revenueWithoutItems = 0` → both bases equal (`150000 === 150000`), profit/margin unchanged;
- legacy fields preserved (`historicalCogs`, `productCount`, retained-COGS profit, zero-sales rows excluded from money totals but counted in `productCount`).

---

## 4. Regression risk

**Low.** All changes are additive or text/label changes on the ME surface:
- `totalNetSales` and profit arithmetic are byte-identical to the previous implementation.
- New fields cannot break existing consumers (not previously present).
- Old CSV consumers keep the same row shape and column order; only the column header label changed and extra trailing disclosure rows were appended.
- No DB read/write semantics changed; ME's Profitabilitas call is untouched, so tenant/branch scoping is unchanged.
- Only reachable risk: a consumer parsing the ME CSV strictly by fixed header names would need to read `"Net Sales (Produk)"`; noted below.

---

## 5. Git status before / after

| | Before M1 | After M1 |
|---|---|---|
| HEAD | `d7f29ac` | `d7f29ac` (unchanged) |
| Tracked modified | 29 | **31** |
| Staged | 0 | **0** |
| Untracked | 62 (incl. `M1-SOLUTION-PROPOSAL.md`) | **65** (+`menu-engineering.summary.ts`, +`menu-engineering.summary.unit.test.ts`, +`M1-IMPLEMENTATION-REPORT.md`) |
| `prisma/schema.prisma` diff | `78 0` | `78 0` (unchanged) |
| New migrations | — | **none** (`prisma/migrations/20261009_add_expense_management/` is **pre-existing** M3 work, untouched) |

All pre-existing uncommitted work preserved. No backfill/historical/OrderItem/snapshot data touched. No commit / push / deploy / VPS / production access. No next phase started.

---

## 6. Known limitations

- Figures cited by the audit (ME `0`, P&L `487000`, 16 orders `517000`) are the audit-time data condition; not re-measured here (no DB reads were required for this additive change).
- The ME CSV column is now `"Net Sales (Produk)"`; any external consumer expecting the literal old header must be updated. This is the intended M1 disclosure.

**STOP — awaiting review.**
