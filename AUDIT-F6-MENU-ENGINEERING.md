# AUDIT-F6-MENU-ENGINEERING.md

**Phase F.6 — Menu Engineering + Cost Intelligence**
**Date:** 2026-09-11
**Verdict:** ✅ PASS — all gates cleared

---

## 1. Scope

Composition + classification layer on top of F.4 (current costing) and F.5 (historical COGS/profitability). No new tables, no migrations, no changes to order/payment/revenue engines.

## 2. Files Created

| File | Purpose |
|------|---------|
| `src/services/menu-engineering/menu-engineering.constants.ts` | Thresholds, insight copy, pure helpers: `calculateMedian`, `resolveMedianScope`, `classifyProduct` |
| `src/services/menu-engineering/menu-engineering.types.ts` | All DTOs + request interface (incl. `exportAll` flag) |
| `src/services/menu-engineering/menu-engineering.service.ts` | `MenuEngineeringService` class — orchestrates profitability + costing + classification |
| `src/services/menu-engineering.service.ts` | Client wrapper (`menuEngineeringService.getReport`) |
| `src/app/api/reports/menu-engineering/route.ts` | GET endpoint (ADMIN only) |
| `src/app/api/reports/menu-engineering/export/route.ts` | CSV export endpoint (ADMIN only, `exportAll: true`) |
| `src/app/admin/menu-engineering/page.tsx` | Admin UI page (summary, quadrant matrix, product table, filters, pagination) |
| `src/services/menu-engineering/menu-engineering.classify.unit.test.ts` | 23 unit tests for pure classification + threshold logic |

## 3. Files Modified

| File | Change |
|------|--------|
| `src/components/admin/reports/report-nav.tsx` | Added "Menu Engineering" pill (adminOnly) |
| `src/app/admin/layout.tsx` | Added PieChart icon + "Menu Engineering" nav item (ADMIN) |

## 4. Architecture

```
GET /api/reports/menu-engineering?period=&branch=&category=&q=&classification=
                                    │
                 ┌──────────────────┤
                 │                  │
    profitabilityService     costingService
    (F.5 historical)        (F.4 current HPP)
                 │                  │
                 └──── merge ───────┘
                        │
              ┌─────────┼─────────┐
              │         │         │
        resolveMedian  classify  paginate
          (median)    (classifyProduct)
```

- **Axes:** X = `qtySold`, Y = `grossProfit` (from profitabilityService, never recomputed)
- **Threshold:** Scoped MEDIAN (never mean). Category scope if ≥5 analyzed products, else branch (if filtered), else restaurant-wide.
- **Guards (order):** no-sales → NEW/NO_DATA → INSUFFICIENT_DATA → UNCOSTED → NO_PRICE → quadrant (STAR/PLOWHORSE/PUZZLE/DOG)
- **All functions in `menu-engineering.constants.ts`** are pure, dependency-free, and unit-testable.

## 5. Hard Constraints — Compliance

| Constraint | Status |
|-----------|--------|
| No migration / no new table | ✅ |
| No schema change | ✅ |
| No AI/LLM | ✅ |
| No duplicate profitability SQL | ✅ |
| No duplicate costing engine | ✅ |
| Port 3001 only | ✅ |
| No changes to order.service.ts / payment | ✅ |
| Public APIs never expose HPP/costStatus | ✅ Verified |
| Historical COGS = OrderItemCostSnapshot.hppTotal | ✅ F.5 engine |
| Current HPP = F.4 engine | ✅ |
| Current selling price = priceOverride ?? price | ✅ Via costingService |
| Historical selling price = unitPrice/totalPrice | ✅ Via profitabilityService |
| Category median < 5 → fallback | ✅ `resolveMedianScope()` |
| HPP = 0 valid (foodCost 0%, margin 100%) | ✅ |
| Price = 0 → NO_PRICE, no div-by-zero | ✅ |
| Negative margin = NEGATIVE MARGIN insight | ✅ |
| Uncosted reason = NO_RECIPE/MISSING_WAC/INACTIVE_INGREDIENT/LEGACY | ✅ |
| Partial coverage → grossProfit null | ✅ |
| ADMIN-only API + CSV export | ✅ `requireRoles(["ADMIN"])` |
| Bounded pagination (default 25, max 100) | ✅ (UI) |
| CSV export includes ALL products (`exportAll`) | ✅ |

## 6. Unit Tests (23/23 PASS)

Run: `npx tsx --test src/services/menu-engineering/menu-engineering.classify.unit.test.ts`

| Test | Result |
|------|--------|
| calculateMedian: empty/single/odd/even | ✅ |
| calculateMedian: no mutation | ✅ |
| resolveMedianScope: category ≥5 | ✅ |
| resolveMedianScope: category <5 + branch → branch | ✅ |
| resolveMedianScope: category <5, no branch → restaurant | ✅ |
| resolveMedianScope: branch only; none | ✅ |
| STAR/PLOWHORSE/PUZZLE/DOG classification | ✅ |
| Boundary inclusive (≥ median) | ✅ |
| orderCount < MIN → INSUFFICIENT_DATA | ✅ |
| qtySold 0 + old → NO_DATA | ✅ |
| qtySold 0 + new → NEW | ✅ |
| grossProfit null + uncostedItems → UNCOSTED with reason | ✅ |
| grossProfit null + legacy → UNCOSTED LEGACY | ✅ |
| grossProfit null, no uncosted → UNCOSTED PARTIAL_COVERAGE | ✅ |
| currentSellingPrice null → NO_PRICE | ✅ |
| currentSellingPrice 0 → NO_PRICE (no div-by-zero) | ✅ |
| No threshold → INSUFFICIENT_DATA | ✅ |
| Negative margin flags insight | ✅ |
| HPP zero not treated as insufficient | ✅ |

## 7. Runtime Tests (32/32 PASS)

Script: `/tmp/opencode/f6-tests.py`

| Category | Tests | Result |
|----------|-------|--------|
| Restaurant-wide read | 1 | ✅ |
| Branch-scoped read | 1 | ✅ |
| Category-scoped read | 1 | ✅ |
| Search filter | 1 | ✅ |
| Date range (custom) | 1 | ✅ |
| No-data / insufficient guards | 1 | ✅ |
| Negative margin structural | 1 | ✅ |
| HPP zero structural | 1 | ✅ |
| NO_PRICE / UNCOSTED / INSUFFICIENT structural | 1 | ✅ |
| Classification filter (9 values) | 9 | ✅ |
| Kasir blocked (403) | 1 | ✅ |
| No-token blocked (401/403) | 1 | ✅ |
| Public menu no-leak (best-sellers + recommendations) | 2 | ✅ |
| CSV export (200, headers, content-type) | 3 | ✅ |
| Pagination (limit=5) | 1 | ✅ |
| Summary + threshold + coverage | 3 | ✅ |
| Classification counts | 1 | ✅ |
| **Total** | **32** | **32/32** |

## 8. Regression: F.1–F.5 (85/85 PASS)

All F.1–F.5 tests remain green. No regressions.

## 9. TypeScript Check

`npx tsc --noEmit` — **clean, zero errors.**

## 10. Production Build

`npm run build` — **success.** Routes present:
- `ƒ /api/reports/menu-engineering`
- `ƒ /api/reports/menu-engineering/export`
- `○ /admin/menu-engineering`

## 11. Nav / UI Integration

| Location | Status |
|----------|--------|
| Admin sidebar: "Menu Engineering" pill | ✅ (`report-nav.tsx`) |
| Admin layout: PieChart icon + nav item | ✅ (`admin/layout.tsx`) |
| Admin page: full menu engineering dashboard | ✅ (`/admin/menu-engineering`) |

## 12. Business Semantics

- **Historical revenue:** PAID-only, CANCELLED excluded (via F.5)
- **Historical COGS:** OrderItemCostSnapshot.hppTotal, frozen at COMPLETED (via F.5)
- **Current HPP:** F.4 engine, branch-scoped
- **Current selling price:** `priceOverride ?? Product.price` (via costingService)
- **Historical selling price:** `OrderItem.unitPrice` (not overridden — expected behavior)
- **Price override badge:** `currentPriceOverrideActive` field shown in UI
- **Add-ons limitation:** No COGS for options/add-ons — disclosed in UI

## 13. Performance

- Server-side aggregation only
- Bounded pagination (UI: 25 default, 100 max; export: exportAll flag)
- Reused F.4/F.5 engines (no N+1)
- `MAX_ACTIVE_PRODUCTS = 5000`, `MAX_FETCH_PAGES = 10`
- `calculateMedian` / `classifyProduct` / `resolveMedianScope` are pure O(n log n)

## 14. Known Notes (by design, not bugs)

1. **Historical selling price ≠ current selling price.** The `unitPrice` in OrderItem is the price at order time. `priceOverride` is not applied at order creation (`order.service.ts:360-361`). UI labels clarify this with "Current margin" vs "Historical margin" + "Branch price override" badge.
2. **Category threshold fallback.** When a category has <5 analyzed products, the median falls back to branch (if filtered) or restaurant-wide. This is the data-driven approach per spec §12.
3. **All-branch current HPP.** First authorized branch used for "Current HPP" columns in the all-branch view. Historical figures remain all-branch.

## 15. DoD Checklist

| Gate | Status |
|------|--------|
| `npx tsc --noEmit` clean | ✅ |
| `npm run build` success | ✅ |
| Unit tests: classifyProduct (23/23) | ✅ |
| Runtime tests: API + guard + auth + public + CSV + pagination + summary (32/32) | ✅ |
| F.1–F.5 regression (85/85) | ✅ |
| No schema changes / migrations | ✅ |
| No new tables | ✅ |
| ADMIN-only enforcement | ✅ |
| Public API no-leak | ✅ |
| Final report written | ✅ This file |

## 16. Git Status

```
On branch f6-menu-engineering
Changes to be committed:
  (new files and modifications listed in git status)
```

No secrets, no uploads, no fixture artifacts, no `.env` changes.

## 17. Cleanup

- No permanent fixtures created or left behind
- `/tmp/opencode/f6-tests.py` — runtime test script (ephemeral)
- `/tmp/opencode/f6-server.log` — server log (ephemeral)
- `/tmp/opencode/f6-server.pid` — server PID (ephemeral)

## 18. Files List

**Created (8):**
- `src/services/menu-engineering/menu-engineering.constants.ts`
- `src/services/menu-engineering/menu-engineering.types.ts`
- `src/services/menu-engineering/menu-engineering.service.ts`
- `src/services/menu-engineering.service.ts`
- `src/app/api/reports/menu-engineering/route.ts`
- `src/app/api/reports/menu-engineering/export/route.ts`
- `src/app/admin/menu-engineering/page.tsx`
- `src/services/menu-engineering/menu-engineering.classify.unit.test.ts`

**Modified (2):**
- `src/components/admin/reports/report-nav.tsx`
- `src/app/admin/layout.tsx`

## 19. Runtime Facts for Future Phases

- Admin credentials: `admin@restobahagia.com / admin123`
- Kasir credentials: `kasir@restobahagia.com / kasir123`
- Restaurant ID: `cmtois12y0000bzu8o894azsd`
- Main branch ID: `cmts3aks100009tu818hblu00`
- Port: `3001` (production)
- Login dance: CSRF → callback → extract session token from Set-Cookie

## 20. Conclusion

F.6 Menu Engineering + Cost Intelligence is **COMPLETE**. All 13 DoD gates passed. The implementation is a pure composition layer reusing F.4/F.5 engines with no new tables, no schema changes, and no modifications to order/payment/revenue logic. Classification logic is unit-tested (23/23) and runtime-verified (32/32). Regression with F.1–F.5 is clean (85/85).

**VERDICT: ✅ PASS**
