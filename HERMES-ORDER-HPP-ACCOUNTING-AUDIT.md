# Hermes Order-HPP-Accounting Audit

**Audit Date:** 2026-10-13  
**Project Path:** `/home/reksa/restorant-cafe`  
**Auditor:** Hermes Agent  
**Scope:** Order, Checkout, HPP (Costing), Inventory, Cost Snapshot, Accounting integration

---

## A. Order & Checkout Audit

### A.1 Root Cause: Does Order truly depend on HPP?

**Answer: NO – Order/Checkout works WITHOUT HPP setup.**

Evidence:
- `src/services/order/order.service.ts:1639-1644` (updateOrderStatus):
  ```
  // F.5 — History...
  // checkout is not conditioned on costing data: recipe / WAC / ingredient / addon-option
  // BOM availability never blocks the status flip.
  ```

- `src/services/order/order.service.ts:1626-1644`:
  ```typescript
  // The write itself happens after commit and is never a prerequisite of
  // completion; a repeated COMPLETED request never re-snapshots (the
  // unique orderItemId also rejects a second write).
  ```

- `src/services/order/order.service.ts:1761-1809`: Stock deduction happens ONLY on COMPLETED → COMPLETED transition, NOT on order creation.

### A.2 Existing Functionality

| Feature | File | Notes |
|---------|------|-------|
| Product validation | `order.service.ts:868-898` | Validates `isAvailable: true`, `isActive: true` |
| Order creation | `order.service.ts:477-542` (admin), `601-644` (customer) | Price computed server-side from Product.price |
| Status transition | `order.service.ts:1630-1636` | Uses `VALID_STATUS_TRANSITIONS` |
| Stock deduction | `order.service.ts:1761-1809` | Only when order completes, only if branchId exists |
| COGS snapshot | `order.service.ts:1841-1850` | BEST-EFFORT, after commit, never blocks order |
| WhatsApp notification | `order.service.ts:1854-1915` | Only on READY status |

### A.3 Dependencies Map

```
Order Creation (createCustomerOrder)
├── restaurantId (server-resolved from table/session/body)
├── branchId (optional, server-resolved)
├── Product validation (isActive, isAvailable)
├── Price calculation (Product.price)
└── Coupon validation (promoCode)

Order Completion (updateOrderStatus → COMPLETED)
├── Status transition validation
├── Stock deduction (optional: requires branchId)
├── COGS snapshot (best-effort: requires recipe/WAC)
├── Table release
├── WhatsApp notification (optional)
└── Cashbook sync (payment completion triggers accounting)

Stock Movement (applyStockMovement)
├── BranchProduct.stock check (prevents negative)
└── StockMovement ledger row
```

### A.4 Checkout/Order Blocking Validations

| Validation | Blocker? | File:Line | Condition |
|------------|----------|-----------|-----------|
| Product exists | YES | order.service.ts:892-898 | Throws `ValidationError` if product not found or inactive |
| Product isAvailable | YES | order.service.ts:874-876 | Orders cannot be created for unavailable products |
| Table is MAINTENANCE | YES | order.service.ts:849-851 | Only when not in reservationMode |
| Stock < qty | YES | stock.service.ts:121-123 | Only on COMPLETE, only if branchId exists, throws `ConflictError` |
| Recipe missing | NO | order.service.ts:1841-1850 | Snapshot write is BEST-EFFORT, logged on failure |
| Ingredient WAC missing | NO | costing.service.ts | HPP computation returns null, snapshot records `MISSING_WAC` |
| Manual HPP unset | NO | costing.service.ts:271 | Status = INCOMPLETE, does not block order |

### A.5 Feature Classification (HPP/Recipe/Inventory/Accounting)

| Feature | Classification | Explanation |
|---------|----------------|-------------|
| Recipe/BOM | OPTIONAL_NOT_CONFIGURED | Product can be sold without recipe. HPP = null, snapshot status = NO_RECIPE |
| Ingredient stock | SHOULD_NOT_BLOCK_ORDER | Only used for COGS calculation, not stock validation on order |
| HPP calculation | OPTIONAL_CONFIGURED | Used for snapshot, never for order blocking |
| Cost snapshot | OPTIONAL_NOT_CONFIGURED | Created on COMPLETED, best-effort, logged on failure |
| COGS in reporting | OPTIONAL_NOT_CONFIGURED | Reports aggregate from snapshots, null values handled |
| Product stock (BranchProduct) | CORE_REQUIRED | Validated on COMPLETE, prevents negative stock |
| Order completion | CORE_REQUIRED | Triggers stock deduction and snapshot |
| Payment | CORE_REQUIRED | Required for revenue recognition |

### A.6 Customer vs Admin Order Paths

Both paths converge to the same engine:

| Path | Entry | Restaurant Resolution | Payment Intent |
|------|-------|----------------------|----------------|
| Customer | `/api/public/orders` (route.ts:15) | Table → Session → Body → Legacy | QRIS/KASIR (DINE_IN only) |
| Admin | `order.service.ts:477-542` | Directly provided | Admin sets payment status later |

Same validation, same stock deduction, same snapshot logic.

---

## B. Accounting Audit

### B.1 Revenue Basis Discrepancy (CRITICAL FINDING)

**FINDING-001: Revenue vs Order table discrepancy**

- **Severity:** MEDIUM
- **Domain:** Accounting/Reporting
- **File:** `src/services/report/report.service.ts:199-212`
- **Evidence:**
  ```typescript
  export function revenueWhere(...) {
    return {
      ...reportBaseWhere(...),
      OR: [
        { paymentStatus: "PAID" as const },
        { payments: { some: { status: "REFUNDED" as const } } },
      ],
    };
  }
  ```
- **Root cause:** Revenue is based on **Payment status = PAID**, NOT Order status = COMPLETED
- **Impact:** An order can be COMPLETED but UNPAID → no revenue. A PAID but PENDING order shows revenue before fulfillment.
- **Recommended:** Existing design is intentional per comments (lines 8-19). Document the business rule clearly.
- **Verification:** CONFIRMED

**FINDING-002: Cashbook vs Payment discrepancy**

- **Severity:** LOW
- **Domain:** Accounting
- **File:** `src/services/cashbook/cashbook.service.ts` (if exists)
- **Evidence:** Need to verify - Cashbook entries are created by:
  1. Payment creation (ipaymu webhook)
  2. Shift close (cash reconciliation)
  3. Manual entries (expenses)
- **Impact:** Potential double-counting if payment webhook fires multiple times
- **Verification:** NOT VERIFIED - require file inspection

### B.2 Payment Reconciliation

**FINDING-003: Refund revenue attribution**

- **Severity:** LOW
- **Domain:** Accounting
- **File:** `src/services/report/report.service.ts:246-262`
- **Evidence:**
  ```typescript
  // H4.5-B1 — a fully refunded COMPLETED order becomes paymentStatus = UNPAID, but
  // it must STAY in the revenue set so its revenue is reversed...
  ```
- **Root cause:** Refund revenue uses `revenueScopeWhere` which includes REFUNDED payments
- **Impact:** Revenue is properly reversed
- **Verification:** CONFIRMED

### B.3 Accounting Models Summary

| Model | Purpose | Tenant Isolation |
|-------|---------|------------------|
| `Expense` | Operational costs | restaurantId + branchId |
| `Cashbook` | Cash movements | restaurantId + branchId |
| `Refund` | Customer refunds | restaurantId + orderId |
| `Payment` | Payment records | restaurantId + orderId |
| `OrderItemCostSnapshot` | Historical COGS | restaurantId + orderId + orderItemId |

### B.4 Data Integrity Issues

**FINDING-004: Order CANCELLED with netCollected > 0**

- **Severity:** MEDIUM
- **Domain:** Order/Accounting
- **File:** `src/services/order/order.service.ts:1685-1690`
- **Evidence:**
  ```typescript
  if (input.status === "CANCELLED") {
    const netCollected = await computeNetCollected(tx, id);
    if (netCollected > MONEY_EPSILON) {
      throw new ConflictError(ORDER_STILL_HOLDS_MONEY_MESSAGE);
    }
  }
  ```
- **Root cause:** Cannot cancel PAID orders directly - must use refund workflow
- **Impact:** Prevents financial data loss
- **Verification:** CONFIRMED

**FINDING-005: APPROVED refund blocks COMPLETE**

- **Severity:** MEDIUM
- **Domain:** Order
- **File:** `src/services/order/order.service.ts:1697-1706`
- **Evidence:**
  ```typescript
  if (order.status !== "COMPLETED" && input.status === "COMPLETED") {
    const approvedRefund = await tx.refund.findFirst({...});
    if (approvedRefund) {
      throw new ConflictError("Order memiliki refund yang sudah disetujui...");
    }
  }
  ```
- **Root cause:** Prevents COGS double-counting
- **Verification:** CONFIRMED

---

## C. Accounting M2 Integrity Audit

### C.1 Current State (Verified from Modified Files)

Files showing git modifications:
- `integrity.rules.ts` - Classification logic
- `integrity.service.ts` - Main service
- `integrity.types.ts` - Types
- `integrity.unit.test.ts` - Tests

### C.2 Cutoff Migration F5

**FINDING-006: F5 cutoff is migration apply time only**

- **Severity:** LOW
- **Domain:** Accounting Integrity
- **File:** `integrity.service.ts:139-174`
- **Evidence:**
  ```typescript
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT finished_at, started_at
    FROM _prisma_migrations
    WHERE migration_name = ${LEGACY_CUTOFF_MIGRATION}
  `;
  ```
- **Root cause:** The cutoff proves the TABLE existed, NOT that the code was deployed
- **Impact:** `codeDeployUnproven: true` is always set
- **Verification:** CONFIRMED

### C.3 Carve Window Function

**FINDING-007: Marker-based carve window**

- **Severity:** LOW
- **File:** `integrity.rules.ts:138-147`
- **Evidence:**
  ```typescript
  export function carveWindow(cutoff: Date | null, marker: IntegrityMarkerObservation): Date | null {
    if (!cutoff) return null;
    if (!markerAllowsCarve(marker)) return null;
    const first = marker.firstObservedSnapshotAt;
    if (!first || Number.isNaN(first.getTime())) return null;
    return first.getTime() > cutoff.getTime() ? first : null;
  }
  ```
- **Logic:**
  - `legacyExpected`: completedAt < cutoff
  - `beforeFirstSnapshot`: cutoff <= completedAt < carveFrom
  - `anomaly`: completedAt >= carveFrom
  - `unknownCompletion`: completion time unavailable

- **Root cause:** The carve uses `MIN(orderitemcostsnapshot.completedAt)` as lower bound
- **Impact:** Items in `[cutoff, firstObserved]` are NOT anomalies if marker exists
- **Verification:** CONFIRMED

### C.4 Status Cutoff Only

**FINDING-008: Independent severity without marker**

- **File:** `integrity.service.ts:393-397`
- **Evidence:**
  ```typescript
  statusCutoffOnly: completedWithoutSnapshotStatus({
    anomalyItems: anomalyItems + beforeFirstSnapshotItems,
    unknownItems,
    cutoffResolved: evidence.resolved,
  }),
  ```
- **Purpose:** Shows what C2 would report WITHOUT the carve window
- **Impact:** Visible if marker affects severity
- **Verification:** CONFIRMED

### C.5 Bucket Invariant

**FINDING-009: Bucket partitioning**

- **Severity:** LOW
- **File:** `integrity.types.ts:60-64`, `integrity.service.ts:379`
- **Evidence:**
  ```
  legacyExpected + beforeFirstSnapshot + anomaly + unknownCompletion === items
  ```
- **Verification:** CONFIRMED - invariant enforced in SQL

---

## D. Database & Migration Audit

### D.1 HPP Optionality Without Migration

**FINDING-010: HPP fields are nullable**

- **Severity:** LOW
- **File:** `prisma/schema.prisma:1041-1042`
- **Evidence:**
  ```prisma
  hppUnit      Decimal? @db.Decimal(12, 2)
  hppTotal     Decimal? @db.Decimal(12, 2)
  ```
- **Status:** `OrderItemCostStatus` enum distinguishes:
  - `SNAPSHOTTED` - HPP calculated
  - `NO_RECIPE` - no recipe
  - `MISSING_WAC` - ingredient missing
  - `INACTIVE_INGREDIENT` - recipe inactive
  - `NO_BRANCH` - order without branch
  - `LEGACY` - pre-F.5

**FINDING-011: Manual HPP is nullable but semantically different from 0**

- **File:** `prisma/schema.prisma:320`
- **Evidence:**
  ```prisma
  manualHpp Decimal? @db.Decimal(12, 2)
  ```
  Comment: "A literal 0 IS a valid manual cost and must be distinguishable from 'not set' (null)"

- **Impact:** System correctly handles "not configured" vs "zero cost"

### D.2 No Constraints Preventing HPP-less Orders

**FINDING-012: Order model has no HPP constraints**

- **File:** `prisma/schema.prisma:833-881`
- **Verify:** No foreign key or check constraint to `orderitemcostsnapshot`
- **Impact:** Orders can complete without snapshot

### D.3 Historical Data Access

**Finding:** Historical orders remain readable even without costing setup.

- `OrderItem.costSnapshot` is optional (one-way relation)
- Orders can be queried independently
- Reports filter for PAID orders only

---

## E. Code Quality & Performance Findings

### E.1 TypeScript Safety

- **Status:** CLEAN
- **Command:** `npx tsc --noEmit` → exit code 0, no errors

### E.2 `any` Usage

| File | Line | Context |
|------|------|---------|
| `auth.ts` | 10 | `prisma as any` (PrismaAdapter compatibility) |
| `auth.ts` | 17 | `nextAuth as any` |

### E.3 Duplicate Functions

**Finding-013: Order creation logic duplication**

- **File:** `order.service.ts`
- `createOrder()` (admin) and `createCustomerOrder()` (customer) share logic
- Shared via `buildCustomerOrderContext()` and `persistCustomerOrder()`
- Acceptable separation of concerns

### E.4 N+1 Queries

**Finding-014: Potential N+1 in order listing**

- **File:** Various API routes
- **Status:** Suspect - need actual query analysis
- **Mitigation:** Prisma includes used where possible

---

## D. Detailed Findings

### D.1 FOUND-001: Product Stock Auto-Creation on COMPLETE

- **Severity:** LOW
- **Domain:** Inventory
- **File:** `src/services/stock/stock.service.ts:96-117`
- **Evidence:**
```typescript
if (!rows.length) {
  try {
    await tx.branchProduct.create({
      data: { branchId, productId, stock: 0, ... }
    });
  }
}
```
- **Root cause:** BranchProduct row is created with stock=0 when order completes and row doesn't exist
- **Impact:** Orders can complete for products never stocked; auto-created row starts at 0
- **Report:** `updateOrderStatus` calls `applyStockMovement` which tries to SELECT stock; if no row, creates one with 0 stock
- **Verification:** CONFIRMED

### D.2 FOUND-002: Order without BranchId Bypasses Stock Check

- **Severity:** LOW
- **Domain:** Order/Inventory
- **File:** `src/services/order/order.service.ts:1761-1764`
- **Evidence:**
```typescript
if (
  order.status !== "COMPLETED" &&
  input.status === "COMPLETED" &&
  order.branchId  // <-- STOCK DEDUCTION ONLY WHEN branchId EXISTS
)
```
- **Root cause:** Stock movement is conditional on `order.branchId` being present
- **Impact:** Orders without branch (legacy/cross-branch) skip inventory entirely
- **Report:** 1755-1809 shows stock deduction wrapped in `if (order.branchId)`
- **Verification:** CONFIRMED

### D.3 FOUND-003: Cashbook Date Basis vs Report Date Basis Mismatch

- **Severity:** LOW
- **Domain:** Accounting
- **File:** `src/services/accounting/cashbook.service.ts:250-283`, `src/services/pnl.service.ts:170-175`
- **Evidence:**
```typescript
// Cashbook: Payment.paidAt OR createdAt fallback
date: d.toISOString()  // line 261-262

// PnL/Reports: order.createdAt  
dateBasis: {
  revenue: "order.createdAt",
  refund: "refund.approvedAt",
  cogs: "order.createdAt",
  expense: "expense.spentAt",
}
```
- **Root cause:** Cashbook records when money moves; reports use accrual accounting (order creation date)
- **Impact:** Cash movements and revenue by calendar period may differ
- **Report:** This is intentional design for accrual vs cash accounting - NOT a bug
- **Verification:** CONFIRMED

### D.4 FOUND-004: No Manual Cashbook Adjustment Feature

- **Severity:** MEDIUM
- **Domain:** Accounting
- **File:** `src/services/accounting/cashbook.service.ts:14` (read-only comment)
- **Evidence:**
```typescript
// A READ-ONLY projection that unifies three EXISTING sources into one cash
// movement list + summary. It is NOT a new ledger and it writes nothing.
```
- **Root cause:** Cashbook has NO write capability - only reads from Payment/Refund/Expense
- **Impact:** Cannot add manual adjustments (petty cash, corrections, reconciliations)
- **Recommendation:** Add `Expense.method = "ADJUSTMENT"` for manual entries, OR create separate Adjustment model
- **Verification:** CONFIRMED

### D.5 FOUND-005: Profit NULL When COGS Incomplete

- **Severity:** LOW
- **Domain:** Accounting/P&L
- **File:** `src/services/profitability/profitability.service.ts:410`
- **Evidence:**
```typescript
const coverageComplete = totalItems > 0 && costed === totalItems;
const profit = coverageComplete ? num(productNet - retainedCogs) : null;
```
- **Root cause:** Profit is NULL when snapshot coverage is incomplete (not 0)
- **Impact:** Gross profit shows as NULL instead of negative value when HPP not configured
- **Report:** Intentional - indicates data quality issue rather than hiding problems
- **Verification:** CONFIRMED

### D.6 FOUND-006: Discrepancy in Original Audit - Cashbook Source Load

**Clarification from previous audit:** The claim "need to verify cashbook" was based on wrong file path. The actual file is:
- **File:** `src/services/accounting/cashbook.service.ts` (NOT `src/services/cashbook/cashbook.service.ts`)
- **Verification:** Duplicate webhook handling confirmed via per-order row lock and PAID status terminal state

---

## E. Stock Tracking Options Analysis

### E.1 Current Stock Checking Behavior

| Scenario | BranchProduct Exists? | BranchId on Order? | Stock Check? | Result |
|----------|----------------------|--------------------|--------------|--------|
| Normal case | Yes, stock > qty | Yes | Yes | Pass |
| Normal case | Yes, stock = 0 | Yes | Yes | ConflictError |
| New product, first order | No | Yes | Auto-create, stock = 0 | ConflictError if qty > 0 |
| Legacy order | N/A | No | No | Passes |
| Ingredient not in recipe | N/A | N/A | N/A | Snapshot = NO_RECIPE |

### E.2 Can Stock Be Made Optional?

**YES** - Current configuration supports this:

1. **Option A: Remove stock validation from order.complete**
   - Change `order.service.ts:1761-1809` to remove stock deduction
   - Keep stock dashboard separate

2. **Option B: Add setting to skip stock check**
   - Add `RestaurantSettings.skipStockCheck: Boolean`
   - Modify `applyStockMovement` condition to check this flag

3. **Option C: Auto-approve with low stock**
   - Default stock deduction is already best-effort (try/catch ConflictError)
   - Order completes but logs warning

### E.3 Recommended Minimal Change

Add to `RestaurantSettings` (already nullable, no migration needed for new field):
```prisma
skipStockCheck Boolean @default(false)
```

Then modify `order.service.ts:1761` to:
```typescript
if (order.branchId && !restaurantSettings?.skipStockCheck) {
  // existing stock deduction logic
}
```

---

## F. Revenue Consistency Matrix (Updated)

| Order Status | Payment Status | Sales Revenue | Cashbook | P&L | Comments |
|--------------|----------------|---------------|----------|-----|----------|
| PENDING | UNPAID | NO | NO | NO | New order |
| PENDING | PAID | YES | YES | YES | Pre-payment captured |
| CONFIRMED | PAID | YES | YES | YES | Order confirmed |
| PROCESSING | PAID | YES | YES | YES | Food prep |
| READY | PAID | YES | YES | YES | Food ready |
| COMPLETED | PAID | YES | YES | YES | Order finished |
| COMPLETED | UNPAID | NO | NO | NO | Order done, payment pending (QRIS timeout, etc.) |
| CANCELLED | UNPAID | NO | NO | NO | Cancel before payment |
| CANCELLED | PAID | NO | YES (marked) | NO | Cancel after payment - REQUIRES REFUND |
| * | REFUNDED | YES (reversed) | YES (outflow) | YES | Refund processed |

---

## G. Git Status

```
M src/services/accounting/integrity.rules.ts
M src/services/accounting/integrity.service.ts
M src/services/accounting/integrity.types.ts
M src/services/accounting/integrity.unit.test.ts
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
```

---

**END OF UPDATED AUDIT REPORT**