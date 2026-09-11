# F.8 — FULL REGRESSION REPORT

> Generated: 2026-09-11
> Branch: `f1-f6-cost-intelligence`
> Scope: F.1 → F.7 treated as ONE system
> Mode: AUDIT → TEST → FINDINGS → (no fix required) → RE-TEST → REPORT
> Git rule honored: **NO COMMIT / NO PUSH / NO MERGE**

---

## 1. Executive Summary

The F.1–F.7 Cost Intelligence stack passes the full regression gate.

- TypeScript: **CLEAN** (`npx tsc --noEmit`, exit 0)
- Production build: **SUCCESS** (`npm run build`, exit 0)
- Unit tests: **43 / 43 PASS** (F.7 = 20, F.6 = 23)
- Live runtime checks on port 3001: **85 / 85 PASS**
  - F.7 + security + validation + report APIs: 69 / 69
  - Branch isolation (same restaurant, unassigned branch): 10 / 10
  - F.2 WAC + idempotency + unit validation (isolated fixture, cleaned up): 6 / 6
- Tenant isolation: **PASS**
- Branch isolation: **PASS**
- Financial integrity (DB-level): **PASS**
- Prisma migration status: **Database schema is up to date** (16 migrations)

No P0, no P1, and no P2 defects were found. **Zero code fixes were required**
and none were made. Two P3 hygiene observations and one pre-existing known
limitation are documented (Section 21 / 23).

No production data was modified. The only test data created (one isolated
ingredient + one purchase) was fully removed and cleanup was verified
(Section 19 / Step 4).

**Final verdict: PASS WITH KNOWN LIMITATIONS** — every PASS gate (no P0/P1,
no unresolved P2, tenant isolation, financial integrity, build, core
regression) is met; the qualifier reflects the intentionally-unfixed
`order.service.ts` pricing discrepancy plus P3 hygiene notes.

---

## 2. Git / Branch State

```
$ git branch
* f1-f6-cost-intelligence
  main

$ git log --oneline --decorate -10
4b5895c (HEAD -> f1-f6-cost-intelligence, origin/f1-f6-cost-intelligence) feat: add cost intelligence foundation F1-F6
c7825cc (origin/main, origin/HEAD, main) fix glitch
d5f5117 audit supply
a74df64 fix error supplie
d11db02 purchasing module
27cb467 feat: add advanced sales reports
f3fb5a8 update kasir
098a8e3 fix glitch and add report kasir
3ad21d8 error handling web1
d0449d9 error handling web
```

```
$ git status
On branch f1-f6-cost-intelligence
Your branch is up to date with 'origin/f1-f6-cost-intelligence'.

Changes not staged for commit:
	modified:   src/app/admin/costing/page.tsx

Untracked files:
	F7-WHATIF-IMPLEMENTATION.md
	src/app/api/admin/simulation/
	src/services/simulation.service.ts
	src/services/simulation/
```

Working tree matches the **expected F.7 change set exactly**:

| File | State |
|------|-------|
| `src/app/admin/costing/page.tsx` | modified |
| `src/app/api/admin/simulation/what-if/route.ts` | untracked (new) |
| `src/services/simulation.service.ts` | untracked (new) |
| `src/services/simulation/simulation.compute.ts` | untracked (new) |
| `src/services/simulation/simulation.service.ts` | untracked (new) |
| `src/services/simulation/simulation.types.ts` | untracked (new) |
| `src/services/simulation/simulation.unit.test.ts` | untracked (new) |
| `F7-WHATIF-IMPLEMENTATION.md` | untracked (new, documentation) |

No unexpected files. No changes to order/payment/customer/auth services.
`F7-WHATIF-IMPLEMENTATION.md` is the F.7 implementation report (documentation
only, no runtime effect). **No commit / push / merge was performed.**

---

## 3. Database / Migration Audit

Artifacts audited: `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts`.

```
$ npx prisma migrate status
Loaded Prisma config from prisma.config.ts.
Datasource "db": MySQL database "restaurant_app" at "localhost:3306"
16 migrations found in prisma/migrations
Database schema is up to date!
```

The F.1–F.7 migration set:

- `20260911_add_ingredient_f1`
- `20260911_add_ingredient_purchasing_wac`
- `20260911_add_recipe_bom`
- `20260911143644_f5_order_item_cost_snapshot`

No new/unknown migrations. No migration was created; no `db push`,
no `migrate reset`, no destructive SQL.

**Model consistency verified in live DB (read-only):**

| Model | Count | Note |
|-------|-------|------|
| Ingredient | 37 | restaurant-scoped |
| BranchIngredient | 30 | `(branchId, ingredientId)` unique |
| IngredientStockMovement | 28 | append-only ledger |
| Recipe | 27 | `productId` unique |
| RecipeItem | 31 | `(recipeId, ingredientId)` unique |
| Purchase | 46 | supplier + branch scoped |
| PurchaseIngredient | 30 | Decimal(18,3) qty |
| OrderItemCostSnapshot | 44 | **44 distinct orderItemId — 0 duplicates** |

Snapshot status distribution: `SNAPSHOTTED=25`, `NO_RECIPE=6`,
`MISSING_WAC=7`, `INACTIVE_INGREDIENT=6`; every non-SNAPSHOTTED row has
`hppTotal IS NULL` (never coerced to 0).

**Migration history note (P3, benign):** `_prisma_migrations` contains one
rolled-back record for `20260911_add_ingredient_f1`
(`rolled_back_at = 2026-09-11 07:38:27`, `finished_at = NULL`) followed by a
successful apply. This is Prisma's normal representation of a failed attempt
that was re-applied; `prisma migrate status` reports the schema up to date and
there is **no duplicate active migration and no drift**.

---

## 4. F.1 Regression — Ingredient + Unit + Branch Stock

Audited: `ingredient.service.ts`, `ingredient-stock.service.ts`,
`ingredient.types.ts`, `/api/admin/ingredients*`.

| Requirement | Result | Evidence |
|-------------|--------|----------|
| Ingredient CRUD | PASS | create/list/get/update, `@@unique([restaurantId, name])` duplicate guard |
| BranchIngredient | PASS | `(branchId, ingredientId)` unique; auto-create on first movement |
| Stock adjustment | PASS | `adjustIngredientStock` target→delta, atomic |
| Stock movement ledger | PASS | append-only `IngredientStockMovement`, `balanceAfter` captured |
| Tenant isolation | PASS | all reads/writes keyed by `ctx.restaurantId` |
| Branch isolation | PASS | `assertBranchInScope` + `authorizedBranches`; runtime 403 |
| ADMIN mutation | PASS | POST/PUT require `ADMIN` |
| CASHIER read-only | PASS | GET lists allow `CASHIER`; mutation routes ADMIN-only (runtime 403) |
| No negative stock | PASS | `balanceAfter < 0` → `ConflictError`; DB check `stock < 0` = 0 rows |
| `restaurantId`/`branchId` scoped | PASS | live isolation matrix |

Notes: `applyIngredientStockMovement` uses `SELECT … FOR UPDATE` on
`branchingredient` + Decimal arithmetic (`quantity` is a signed number, balance
computed as `Decimal`), matching the existing product-stock pattern. Live
runtime: admin ingredient list 200 / cashier list 200 / cashier costing 403 /
cross-restaurant branch 403.

---

## 5. F.2 Regression — Ingredient Purchasing + WAC

Audited: `purchase.service.ts` (`createPurchase`, `receivePurchase`,
`cancelPurchase`, `normalizeIngredientItems`), `/api/admin/purchases*`.

**Known expected scenario reproduced live (isolated fixture, since removed):**

```
10 KG @ 18,000
+ 5 KG @ 20,000
= 15 KG
=> BranchIngredient.averageCost = 18,666.67   ✅
```

Observed DB row after receive: `stock = 15.000`, `averageCost = 18666.67`,
`lastPurchaseCost = 20000.00`. Exactly **one** `PURCHASE_RECEIVE` IN movement
(quantity 15.000, balanceAfter 15.000, single refId) — **no double stock
addition**.

| Requirement | Result | Evidence |
|-------------|--------|----------|
| PurchaseIngredient create | PASS | draft 201; server-derived `lineTotal`/`total` (280000) |
| Receive | PASS | DRAFT→RECEIVED atomic, 201 |
| WAC calculation | PASS | live `18666.67` as expected |
| Duplicate receive | PASS | second receive → **409**, no extra stock/movement |
| Mixed purchase | PASS | product items + ingredient items in one purchase, totals summed |
| Duplicate ingredient aggregation | PASS | two lines for same ingredient aggregated (qty + cost) before WAC |
| Unit validation | PASS | unit ≠ baseUnit → **400** (no purchase row created) |
| Idempotency | PASS | conditional status `updateMany` gate inside the tx |

WAC semantics verified in code: `oldStock` is derived back from
post-receive balance (`newStock − receivedQty`) so the received quantity is not
double-counted; `effectiveUnitCost = totalCost / totalQty` stays in Decimal
space; persisted `Decimal(12,2)` rounding happens only at the write boundary.

---

## 6. F.3 Regression — Recipe / BOM

Audited: `recipe.service.ts`, `recipe.types.ts`,
`/api/admin/menu/products/[productId]/recipe`.

| Requirement | Result | Evidence |
|-------------|--------|----------|
| Recipe CRUD | PASS | upsert (create/replace) + soft delete (`isActive=false`) |
| RecipeItem CRUD | PASS | `deleteMany` + `createMany` in one transaction |
| Duplicate ingredient rejection | PASS | Zod refine + service `Set` check → 400 |
| Unit matching | PASS | `item.unit !== ingredient.baseUnit` → 400 |
| restaurant isolation | PASS | product + ingredients scoped by `restaurantId` |
| branch access | PASS | recipe is restaurant-level (composition only), no branch leakage |

**DB verification:** `recipeitem.unit <> ingredient.baseUnit` → **0 rows**;
cross-restaurant ingredient linked into a recipe → **0 rows**.

No conversion engine exists (by design). `RecipeItem.unit === Ingredient.baseUnit`
is enforced at both API and service layers. Recipe endpoints never expose
`averageCost` / `lastPurchaseCost` / stock.

---

## 7. F.4 Regression — Costing Engine

Audited: `costing.service.ts`, `costing.types.ts`,
`/api/admin/costing/products[/productId]`.

Formula verified in code: `HPP = Σ (RecipeItem.quantity × BranchIngredient.averageCost)`,
effective price `BranchProduct.priceOverride ?? Product.price`.

| Case | Result |
|------|--------|
| COMPLETE | PASS (sum of covered items) |
| NO_RECIPE | PASS (hpp null) |
| INCOMPLETE | PASS (hpp null, covered item costs still returned) |
| MISSING_WAC | PASS (null, never 0) |
| INACTIVE_INGREDIENT | PASS (null, never 0) |
| HPP = 0 | PASS (literal WAC 0 is valid → `"0.00"`, margin 100%) |
| HPP = null | PASS (rendered null, not 0) |
| price = 0 | PASS (margin/food-cost null; no division) |
| Decimal precision | PASS (Prisma.Decimal end-to-end, `Number()` forbidden) |
| ROUND_HALF_UP | PASS (2 dp at output boundary) |

**No duplicate costing engine.** `averageCost` is referenced only by
`costing.service.ts` (F.4), `historical-snapshot.ts` (F.5) and
`purchase.service.ts` (F.2 WAC write). F.6 imports F.4/F.5; F.7 imports F.4.
No HPP is recomputed anywhere else.

Live runtime: `F5-Burger` current price 35000 / HPP 19600 (0.200 × 98000) was
returned correctly via both the costing API and the F.7 simulation, proving the
F.1→F.2→F.3→F.4 data pipeline end-to-end.

---

## 8. F.5 Regression — Historical COGS + Profitability

Audited: `historical-snapshot.ts`, `profitability.service.ts`,
`order.service.ts` (COMPLETED transition), `/api/reports/profitability[/export]`.

| Requirement | Result |
|-------------|--------|
| `OrderItemCostSnapshot` one per OrderItem | PASS (44 rows / 44 distinct orderItemId) |
| Historical COGS = `hppTotal` | PASS |
| `profitabilityService` | PASS (server-side SQL aggregation) |
| Completion snapshot | PASS (written inside the guarded READY→COMPLETED transaction, exactly once) |
| Revenue = PAID ∧ status ≠ CANCELLED | PASS (`soldWhere`) |
| COGS recognition = SNAPSHOTTED only | PASS (`SUM(hppTotal WHERE status='SNAPSHOTTED')`) |
| NO_RECIPE / MISSING_WAC / INACTIVE_INGREDIENT | PASS (null hpp; disclosed via `coverage`) |
| LEGACY | PASS (`COMPLETED AND s.id IS NULL`, disclosed not backfilled) |
| zero HPP | PASS (WAC 0 → `SNAPSHOTTED` with `hppUnit/hppTotal = 0`) |
| partial coverage | PASS (`uncostedItems`, grossProfit null when not covered) |
| refund | PASS (APPROVED refunds net against net sales, per branch) |
| unpaid completed order | PASS (disclosed in `unpaidCompleted`, not counted as revenue) |

**DB verification:** `hppTotal < 0` → 0 rows; `status='SNAPSHOTTED' AND ABS(hppTotal − ROUND(hppUnit×quantity,2)) > 0.001` → **0 mismatches**.

Missing HPP is never treated as zero COGS (null propagates through and is
disclosed). Snapshot is only written on a real transition
(`order.status !== "COMPLETED" && input.status === "COMPLETED"`), so repeat
COMPLETED requests cannot double-snapshot.

---

## 9. F.6 Regression — Menu Engineering

Audited: `menu-engineering.service.ts`, `menu-engineering.constants.ts`,
`menu-engineering.classify.unit.test.ts`, `/api/reports/menu-engineering[/export]`.

- X axis = `qtySold`, Y axis = historical `grossProfit` — PASS
- Classification STAR / PLOWHORSE / PUZZLE / DOG — PASS (23 unit tests)
- Threshold = scoped **median** (never mean) — PASS
- Restaurant-wide scope / branch scope / category scope / category fallback — PASS (`resolveMedianScope`)
- Insufficient data, NEW, NO_DATA, UNCOSTED, PARTIAL_COVERAGE, NO_PRICE, negative margin — PASS
- **UNCOSTED ≠ COGS zero** — PASS (`grossProfit === null` ⇒ UNCOSTED, never coerced)

DB/runtime: category medians only used at ≥ 5 analyzed products; `NO_PRICE`
applied when current selling price ≤ 0; `UNCOSTED` reason from dominant
non-SNAPSHOTTED snapshot status (`LEGACY` when only legacy items).

Boundary is inclusive (`>= median`) and median does not mutate input (unit-
tested). 23/23 classify/median unit tests pass.

---

## 10. F.7 Regression — What-If Simulation

Audited: `simulation.compute.ts`, `simulation.types.ts`,
`simulation.service.ts`, `what-if/route.ts`, client wrapper,
costing page dialog, `simulation.unit.test.ts`.

Formulas verified live and by unit test:

| Mode | Formula | Live result (price 35000, HPP 19600) |
|------|---------|--------------------------------------|
| `price` | price × (1 + pct/100) | +10% → **38500.00** ✅ |
| `hpp` | hpp × (1 + pct/100) | −10% → **17640.00** ✅ |
| `target_margin` | hpp / (1 − m/100) | 40% → **32666.67** ✅ |
| `combined` | both simultaneously | +10%/−10% → price **38500.00**, hpp **17640.00**, GP **20860.00**, margin **54.18** ✅ |

Financial math: `Prisma.Decimal`, `ROUND_HALF_UP`, 2 dp final boundary — PASS.
Division-by-zero yields **null, never NaN** — PASS.

| Edge case | Result |
|-----------|--------|
| HPP = 0 | PASS (margin 100.00%, foodCost 0.00%) |
| HPP = null | PASS (price mode still projects price; profit metrics null + warning) |
| price = 0 | PASS (warning "Harga jual nol") |
| negative margin | PASS (shown as-is + "Margin negatif" warning) |
| target margin 99.99 | PASS (200) |
| target margin 100 | PASS (**400 rejected**) |
| division by zero (`currentGrossProfit = 0`) | PASS (`profitChangePct = null`) |
| missing inputs | PASS (400) |
| invalid mode | PASS (400) |
| non-JSON / empty body | PASS (400) |

**Terminology lock verified:** the response field is `impact.profitPerUnit`
and the UI label is **"Gross Profit Impact / Unit"**. A repo-wide search for
`profit/order`, `forecast profit`, `restaurant profit`, `profitPerOrder`,
`forecastProfit` returned **0 matches**. Simulation remains strictly per-unit;
no historical-quantity extrapolation.

F.7 uses F.4 `costingService.getCostingDetail` as the SOLE source of current
HPP/price — no duplicate HPP calculation. Response is read-only; DB was proven
unchanged after 69 simulation/report calls (Section 18).

Unit tests: **20 / 20 PASS**.

---

## 11. Authentication / Authorization

| Check | Result |
|-------|--------|
| Unauthenticated → 401 | PASS (S01) |
| CASHIER → 403 | PASS (S02b what-if, S02c costing, S02e profitability, S30 menu-engineering, B09) |
| ADMIN → allowed | PASS (S03a + all admin reads) |
| CASHIER read-only allowed where intended | PASS (ingredients list 200, ingredient stock 200, purchases list 200) |
| Cross-restaurant → rejected | PASS (S19 what-if 403, S25 costing 403, S27 profitability 403, S29 menu-engineering 403, S33 stock 403/404) |
| Cross/unassigned branch → rejected | PASS (S20, B02–B08) |
| Bogus product → rejected | PASS (S22 → 404) |
| Bogus branch → rejected | PASS (S21 → 403) |
| No public simulation endpoint | PASS (`/api/admin/simulation/what-if` is ADMIN-gated; no `/api/public/*` cost endpoint) |
| No customer data exposed | PASS (cost DTOs contain product/ingredient/cost only) |
| No payment secrets exposed | PASS (cost/sim DTOs never touch payment/provider fields) |

Security is layered: `requireRoles(["ADMIN"], branchId)` (auth + branch
ownership) → Zod `safeParse` (400) → `assertBranchInScope` inside F.4
(403) → product re-scoped by `restaurantId` (404 for foreign products).

---

## 12. Tenant Isolation

Two restaurants exist in the DB (`Restoran Bahagia`, `Restoran B`).
Client-supplied ids never override server context: `restaurantId` is always
taken from the authenticated user record (`requireRestaurantContext`), never
from the request.

Verified live: a spoofed `restaurantId` field in the simulation body was
ignored (S23 — 200 with the caller's own branch data). Restaurant B's branch
(`TEST-BR-BKS`) was rejected with 403 from every read surface (costing,
profitability, menu-engineering, ingredient stock, purchases). Foreign
products resolve to 404. **Result: PASS.**

---

## 13. Branch Isolation

Admin `admin@restobahagia.com` is assigned to **Main Outlet only**, while
`TEST-BR-JKT` belongs to the same restaurant but is **not assigned**.
Runtime matrix (10/10 PASS):

| Endpoint (branch = TEST-BR-JKT) | Expected | Result |
|---------------------------------|----------|--------|
| costing list | 403 | PASS |
| costing detail | 403 | PASS |
| profitability | 403 | PASS |
| menu-engineering | 403 | PASS |
| ingredient stock | 403/404 | PASS |
| purchases | 403 | PASS |
| stock movements | 403 | PASS |

Assigned branch (`MAIN`) returns 200; CASHIER is 403 on costing and 200 on
ingredient stock. Branch scope is derived from `UserBranch` assignments via
`authorizedBranches` / `assertBranchInScope`; a headerless scoped request never
widens to the whole restaurant. **Result: PASS.**

---

## 14. Order / Payment Regression

F.1–F.7 must not break the existing transaction flow. Verified:

- The only integration point is the F.5 snapshot on READY→COMPLETED inside
  `order.service.ts`'s existing guarded transaction — no other order code path
  was touched.
- `git status` shows **no modifications** to order/payment/customer services in
  the F.7 change set.
- Snapshot writes are additive and rolled back with the surrounding
  transaction; the status-transition conditional update and stock-deduction
  path are unchanged.
- Build compiles all order/payment/shift/QRIS routes successfully.

Explicitly not changed (as required): Order pricing, Payment, QRIS, Cash,
WhatsApp, customer ordering.

**Known limitation (documented, NOT fixed):** `order.service.ts` still uses
`Number(product.price)` (lines 360–361 and 663) instead of
`BranchProduct.priceOverride`. Costing/simulation use
`priceOverride ?? product.price`. This is a pre-existing, product-decision
discrepancy and was intentionally left untouched per the F.8 rules.

---

## 15. Customer Regression

No F.1–F.7 change touches customer-facing code (`src/app/(customer)/*`,
`src/app/api/public/*`, recommendation service). The cost/simulation routes are
under `/api/admin` and `/api/reports` only; **no cost data is exposed to public
or customer APIs**. The build compiles every customer page
(menu, cart, checkout, order, payment, table/QR context, branch picker).
Result: no observable customer behavior change from F.1–F.7.

---

## 16. Admin UI Regression

All admin pages compile in the production build (dashboard, orders, menu,
tables, customers, payments, settings, reports, purchasing, inventory, kitchen,
**costing**, **profitability**, **menu-engineering**, plus the F.7 dialog).

- Costing page: loading state, empty state, pagination, detail dialog, and the
  new **What-If** dialog (mode toggle, per-mode inputs, submit disabled until
  valid, error banner, warnings, projected grid, "Gross Profit Impact / Unit",
  branch-price note) reviewed.
- Menu Engineering / Profitability pages reviewed for label consistency
  (historical vs current HPP/price, coverage disclosure).
- Parameterized SQL in F.5/F.6 uses `Prisma.sql`/`Prisma.join` (no string
  interpolation of user input).
- F.7 dialog session reset on open; errors surfaced without crashing.
- No `console`/runtime errors introduced by the F.7 code paths; production
  build reports no page/render errors.

Caveat: rendered-state assertions were validated by code review + successful
production compilation, not by a browser-driven UI suite (none exists in the
repo).

---

## 17. API Regression

API surface enumerated under `src/app/api`. F.1–F.7 routes and their guards:

| Route | Method | Guard |
|-------|--------|-------|
| `/api/admin/ingredients` | GET / POST | ADMIN+CASHIER / ADMIN |
| `/api/admin/ingredients/[id]` | GET / PUT | ADMIN+CASHIER / ADMIN |
| `/api/admin/ingredients/stock` | GET | ADMIN+CASHIER + branch scope |
| `/api/admin/ingredients/stock/[ingredientId]` | PUT | ADMIN + branch scope |
| `/api/admin/purchases` | GET / POST | ADMIN+CASHIER read / ADMIN write + `assertBranchInScope` |
| `/api/admin/purchases/[id]/receive` | POST | ADMIN + branch scope |
| `/api/admin/menu/products/[productId]/recipe` | GET / PUT / DELETE | ADMIN+CASHIER / ADMIN / ADMIN |
| `/api/admin/costing/products` | GET | ADMIN + `assertBranchInScope` |
| `/api/admin/costing/products/[productId]` | GET | ADMIN + `assertBranchInScope` |
| `/api/admin/simulation/what-if` | POST | ADMIN + branch ownership |
| `/api/reports/profitability[/export]` | GET | ADMIN + branch scope |
| `/api/reports/menu-engineering[/export]` | GET | ADMIN + branch scope |

Checks: auth (401), tenant scope, branch scope, Zod validation (400),
error-response contract (`AppError` → code/status), correct HTTP status, no
secret leakage. Every relevant route returned the expected status in the live
matrix. No API was modified.

---

## 18. Financial Integrity

Verified (code + live DB + runtime):

- Product price vs BranchProduct `priceOverride` — effective price
  `priceOverride ?? product.price` in F.4/F.6/F.7 (order flow discrepancy
  documented in Section 14).
- Recipe → WAC → current HPP (F.4) and historical HPP (F.5) kept separate.
- Current HPP **never** mixed with historical HPP (F.5 reads snapshot only;
  F.4 never reads snapshots).
- Current price **never** mixed with historical selling price (F.5 uses
  `OrderItem.unitPrice/totalPrice`; F.6 labels both axes).
- `null` HPP **never** coerced to `0` (F.4, F.5, F.6, F.7 all propagate null and
  disclose coverage).
- Cancelled/failed orders excluded from revenue (`status <> 'CANCELLED' AND
  paymentStatus = 'PAID'`); refunds net out; unpaid completed orders disclosed,
  not recognized.
- DB-level: 0 negative stock, 0 negative WAC, 0 negative `hppTotal`, 0 snapshot
  arithmetic mismatches, 0 recipe-unit mismatches, 0 duplicate snapshots.

**DB immutability proven:** pre/post counts across 11 tables
(`ingredient, branchingredient, ingredientstockmovement, recipe, recipeitem,
purchase, purchaseingredient, order, orderitem, orderitemcostsnapshot,
stockmovement`) were identical after the 69-check live matrix:

```
37  30  28  27  31  46  30  130  123  44  98   (before)
37  30  28  27  31  46  30  130  123  44  98   (after)   → UNCHANGED
```

---

## 19. Performance

- **No N+1 in F.4/F.5/F.7.** F.4 fetches product→recipe(items)→ingredient→
  branchIngredient in ONE query; F.5 uses one batched query + `createMany`;
  F.7 does ≤ 3 reads; F.6 reuses the F.4/F.5 engines.
- **Server-side aggregation.** F.5 uses `aggregate` + raw `GROUP BY`; F.6 reuses
  those rows and adds one lightweight `GROUP BY` for branch qty. Financial
  aggregation is not done in the browser.
- **Bounded results.** F.4 paginates (limit ≤ 100); F.5 caps limit ≤ 200;
  F.6 `MAX_FETCH_PAGES`/`FETCH_LIMIT` bound the composition loop; ledger reads
  capped (≤ 500).
- **F.7 uses F.4 costingService** — no duplicate HPP calculation, no extra
  engine.
- F.7 response left the DB untouched — no accidental per-request writes.

No unbounded "load all orders/products into the browser" path found in the
cost/profitability/menu-engineering surfaces.

---

## 20. Build / TypeScript

```
$ npx tsc --noEmit
EXIT=0            # clean, no errors

$ npm run build
▲ Next.js 16.3.3
BUILD_EXIT=0      # success — all routes compiled
```

Unit tests:

```
$ npx tsx --test src/services/simulation/simulation.unit.test.ts
tests 20 | pass 20 | fail 0

$ npx tsx --test src/services/menu-engineering/menu-engineering.classify.unit.test.ts
tests 23 | pass 23 | fail 0
```

Live runtime (production build on **port 3001**, port 3000 untouched):

```
F.7 + security + validation + reports : 69 PASS / 0 FAIL
Branch isolation                      : 10 PASS / 0 FAIL
F.2 WAC + idempotency (isolated)      :  6 PASS / 0 FAIL
                                        -------------------
                                        85 PASS / 0 FAIL
```

---

## 21. Bugs Found

**No P0, P1, or P2 bugs.**

| ID | Class | Finding | Status |
|----|-------|---------|--------|
| F8-A | P3 | `historical-snapshot.ts` → `computeHistoricalHpp` has an unused `missingReason` local and an unreachable `else` branch after the `incomplete` guard. Dead code only; behavior is correct. | Documented, not changed (no refactor per F.8 rules) |
| F8-B | P3 | `_prisma_migrations` retains a rolled-back `20260911_add_ingredient_f1` record followed by a successful apply. Normal Prisma history; `migrate status` = up to date. | Documented, no action |
| F8-C | Known limitation | `order.service.ts` uses `Number(product.price)` instead of `BranchProduct.priceOverride` (lines 360–361, 663). | Documented, intentionally NOT fixed |

---

## 22. Fixes Applied

**None.** No P0/P1/P2 defect was found, so no business logic, API, or schema was
modified. Unrelated refactoring was explicitly avoided. The working tree after
F.8 is identical to the F.7 change set (Section 2).

---

## 23. Remaining Known Limitations

1. **Order pricing discrepancy (must remain documented):** `order.service.ts`
   uses `Product.price` instead of `BranchProduct.priceOverride`. Costing /
   menu-engineering / what-if use the branch-effective price. Intentionally
   left unfixed in F.8 pending a product decision.
2. **What-if impact is per-unit only.** No historical-quantity extrapolation;
   no "profit/order", "forecast profit", or "restaurant profit" wording or math.
3. **What-if is single-branch.** Each request targets exactly one branch; no
   all-branch simulation.
4. **Historical COGS depends on snapshot coverage.** Pre-F.5 orders are
   `LEGACY` (not backfilled) and are disclosed rather than estimated.
5. **No conversion engine.** Recipe and purchase units must equal the
   ingredient base unit (by design).
6. **UI runtime:** admin/customer page states were validated by code review and
   successful production compilation; the repo has no browser-driven UI or
   end-to-end test harness.
7. **Runtime mutation coverage:** F.2 WAC/idempotency was exercised live with an
   isolated fixture; F.1 stock adjustment / F.3 recipe mutation paths were
   verified statically + at DB-integrity level (no throwaway production data
   beyond the single cleaned-up F.2 fixture).

---

## 24. Final Verdict

**PASS WITH KNOWN LIMITATIONS**

```text
P0 (security/data/payment corruption) : none
P1 (core transaction regression)       : none
P2 (feature regression)                 : none unresolved
P3 (cosmetic/hygiene)                   : 2 documented, non-blocking

Tenant isolation  : PASS
Branch isolation  : PASS
Financial integrity: PASS
Core regression   : PASS
Build / TypeScript: PASS
Unit tests        : 43/43 PASS
Runtime checks    : 85/85 PASS
```

The F.1–F.7 system is production-ready. The verdict qualifier reflects the
**intentionally unfixed** `order.service.ts` `Product.price` vs
`BranchProduct.priceOverride` discrepancy (documented, not silently changed)
plus two P3 hygiene notes.

Git rule honored: **no commit, no push, no merge.** Report written; stopping here.
