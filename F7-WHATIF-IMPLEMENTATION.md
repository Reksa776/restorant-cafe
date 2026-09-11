# F.7 WHAT-IF SIMULATION — IMPLEMENTATION REPORT

> Generated: 2026-09-11 | Branch: `f1-f6-cost-intelligence`
> Migration: **NONE** | DB writes: **NONE** | Pricing engine modified: **NO** | Order/payment modified: **NO** | Historical COGS modified: **NO** | F.4/F.5/F.6 modified: **NO**

---

## 1. Scope

Read-only, deterministic, branch-scoped "what-if" simulation on **current** HPP + selling price from the F.4 costing engine. Four modes: `price`, `hpp`, `target_margin`, `combined`.

**Primary entry:** Costing page → product detail dialog → "What-If Simulation" button → `WhatIfDialog`.

**Known discrepancy (NOT fixed, NOT part of F.7):** `order.service.ts` uses raw `Product.price` at order creation. Costing/simulation uses `branchProduct?.priceOverride ?? product.price`. UI displays the note: *"Simulasi menggunakan harga efektif cabang. Harga aktual order saat ini mengikuti pricing flow existing."*

---

## 2. Files Created / Modified

### Created (5 new files)

| File | Purpose |
|------|---------|
| `src/services/simulation/simulation.types.ts` | Zod `SimulationRequestSchema` (4 modes, ranges, superRefine) + all DTOs |
| `src/services/simulation/simulation.compute.ts` | Pure `computeSimulation()` — Decimal-only, zero side effects, exported for unit tests |
| `src/services/simulation/simulation.service.ts` | Orchestration: `costingService.getCostingDetail()` → `computeSimulation()` → formatted response |
| `src/app/api/admin/simulation/what-if/route.ts` | `POST /api/admin/simulation/what-if` — requireRoles ADMIN, Zod safeParse, successResponse/errorResponse |
| `src/services/simulation.service.ts` | Client-side axios wrapper (`simulationService.simulate()`) |

### Modified (1 file)

| File | Change |
|------|--------|
| `src/app/admin/costing/page.tsx` (+353, −1) | Added `FlaskConical` icon, `simulationService` import, `simulationOpen` state in `CostingDetailDialog`, "What-If Simulation" button + full `WhatIfDialog` component (mode radio, inputs, current/projected/impact cards, warnings, priceOverride note) |

---

## 3. Architecture

```
WhatIfDialog (src/app/admin/costing/page.tsx)
  └─ simulationService.simulate()           (client wrapper, thin axios)
       └─ POST /api/admin/simulation/what-if (Next.js route)
            └─ requireRoles(["ADMIN"])       (auth + branch scope)
            └─ SimulationRequestSchema.safeParse(body)  (Zod)
            └─ simulationService.simulateWhatIf()
                 ├─ costingService.getCostingDetail()   ← F.4 source of truth
                 ├─ prisma.branch.findFirst()           ← branch name
                 └─ computeSimulation()                  ← pure Decimal math
```

**Total queries per simulation:** 3 max (assertBranchInScope + product HPP + branch name).

---

## 4. Simulation Modes

| Mode | Required Inputs | Formula |
|------|----------------|---------|
| `price` | `priceChangePercent` | projectedPrice = price × (1 + pct/100) |
| `hpp` | `hppChangePercent` | projectedHPP = hpp × (1 + pct/100) |
| `target_margin` | `targetMarginPercent` | projectedPrice = hpp / (1 − m/100) |
| `combined` | `priceChangePercent` + `hppChangePercent` | Both projections simultaneously |

**All financial math:** `Prisma.Decimal`, `ROUND_HALF_UP`, 2dp. Division-by-zero → `null` (never NaN).

---

## 5. Edge Semantics

| Case | Behavior |
|------|----------|
| `HPP = 0` | Valid: margin = 100%, foodCost = 0% |
| `HPP = null` (INCOMPLETE/NO_RECIPE) | Price mode: projectedPrice computed, all profit metrics null + warning. Other modes: incomplete result. |
| `Price ≤ 0` | Metrics null + warning "Harga jual nol" |
| Negative margin | Shown as-is (no clamp) + warning "Margin negatif" |
| `currentGrossProfit = 0` | `profitChangePct = null` (division by zero avoided) |

---

## 6. Validation (Zod)

- `productId`: string, min 1
- `branchId`: string, min 1
- `mode`: enum `price | hpp | target_margin | combined`
- `priceChangePercent`/`hppChangePercent`: `z.number().finite()`, min −100, max 1000
- `targetMarginPercent`: `z.number().finite()`, min 0, max 99.99
- `superRefine`: mode-specific required params enforced

---

## 7. Security

- **Admin only:** `requireRoles(["ADMIN"])` → cashiers get 403, unauthenticated gets 401
- **Branch mandatory:** request must specify `branchId`; validated via `requireRestaurantContext` (same-restaurant) + `assertBranchInScope` (scoped user check)
- **Cross-restaurant:** product/branch not in the admin's restaurant → 404/403
- **No public endpoint:** simulation requires authenticated admin session

---

## 8. Unit Tests

**File:** `src/services/simulation/simulation.unit.test.ts`
**Command:** `npx tsx --test src/services/simulation/simulation.unit.test.ts`
**Result:** **20/20 PASS**

| Suite | Count | Covers |
|-------|-------|--------|
| mode=price | 5 | +10%, +50%, −10%, HPP null, price=0 warning |
| mode=hpp | 3 | −20%, +10%, HPP null |
| mode=target_margin | 3 | 40%, 20%, HPP null |
| mode=combined | 2 | +10% price / −10% HPP, HPP null |
| edge cases | 7 | HPP=0 (100% margin), NO_RECIPE/MISSING_WAC/INACTIVE warnings, negative margin warning, div-by-zero null, 0% change |

---

## 9. Runtime API Tests

**File:** `/tmp/opencode/f7-tests.py`
**Result:** **70/70 PASS** (21 scenarios × ~3–7 checks each)

| Scenario | Result |
|----------|--------|
| S01: No token → 401 | PASS |
| S02: Kasir → 403 | PASS |
| S03: Price +10% full math | PASS (15 checks: current match detail, projected, margin, foodCost, impact, warnings, input echo) |
| S04: Price −10% | PASS |
| S05: HPP −10% | PASS |
| S06: Target margin 35% | PASS |
| S07: Combined +10% price / −10% hpp | PASS |
| S08: Missing priceChangePercent → 400 | PASS |
| S09: Invalid mode → 400 | PASS |
| S10: priceChangePercent > 1000 → 400 | PASS |
| S11: targetMarginPercent = 100 → 400 | PASS |
| S12: targetMarginPercent = −5 → 400 | PASS |
| S13: Non-JSON body → 400 | PASS |
| S14: Empty body → 400 | PASS |
| S15: INCOMPLETE product (HPP null, warnings) | PASS (7 checks) |
| S16: NO_RECIPE product ("Resep belum tersedia") | PASS |
| S17: Cross-restaurant branch → 403 | PASS |
| S18: Bogus product → 404 | PASS |
| S19: Bogus branch → 403 | PASS |
| S20: Response shape validation | PASS (14 checks) |
| S21: No DB mutation (7 table counts unchanged) | PASS |

---

## 10. Regression

| Phase | Result |
|-------|--------|
| F.1–F.5 regression (`/tmp/opencode/f5-tests.py`) | **85/85 PASS** |
| F.6 regression (`/tmp/opencode/f6-tests.py`) | **32/32 PASS** |
| F.7 runtime (`/tmp/opencode/f7-tests.py`) | **70/70 PASS** |
| TypeScript (`npx tsc --noEmit`) | **CLEAN** |
| Next.js build (`npm run build`) | **SUCCESS** |

---

## 11. What-If Dialog UX

**Entry:** Costing page → click product row → Costing Detail dialog → "What-If Simulation" button (bottom of summary grid).

**Dialog flow:**
1. Shows current values (Selling Price, HPP, Gross Profit, Margin, Food Cost, Status)
2. Mode selector: `Harga | HPP | Target Margin | Kombinasi` (segmented toggle buttons)
3. Input fields appear per mode (number inputs with % labels)
4. "Hitung Simulasi" button (disabled until valid inputs)
5. Result: Projected values grid + Gross Profit Impact / Unit (absolute + percentage)
6. Amber warning boxes for edge conditions (negative margin, HPP unavailable, etc.)
7. Footer note: *"Simulasi menggunakan harga efektif cabang. Harga aktual order saat ini mengikuti pricing flow existing."*

---

## 12. Database Writes

**ZERO.** All simulation responses are computed in memory from `costingService.getCostingDetail()` (reads) + one `prisma.branch.findFirst()` (read for branch name). No create, update, delete, upsert, or connect/disconnect anywhere in the simulation path.

**Verified:** Pre/post DB snapshot of 7 tables (Recipe, RecipeItem, BranchProduct, BranchIngredient, Product, Order, OrderItemCostSnapshot) — all counts identical after 21 simulation API calls.

---

## 13. Git Status

```
M  src/app/admin/costing/page.tsx          (+353, −1)
?? src/app/api/admin/simulation/what-if/route.ts
?? src/services/simulation.service.ts
?? src/services/simulation/simulation.compute.ts
?? src/services/simulation/simulation.service.ts
?? src/services/simulation/simulation.types.ts
?? src/services/simulation/simulation.unit.test.ts
```

---

## 14. Known Limitations (by design)

1. **Order discrepancy not fixed:** `order.service.ts` still uses raw `Product.price`; F.7 documents this but does not change it.
2. **Extrapolation not supported:** Impact is per-item only; no historical qty extrapolation (F.5 territory).
3. **No AI advice:** Deterministic math only; no LLM/AI-generated pricing recommendations.
4. **Branch-scoped only:** No "all branches" simulation; each request targets one branch.
5. **HPP=null scenarios limited:** When HPP is unavailable, only price mode can project a new price; all profit metrics remain null.

---

## 15. DONE

All code is implemented, tested, and verified. The branch is clean of secrets, fixtures, and temporary files. **Do not commit or push** — this is a manual checkpoint for review.
