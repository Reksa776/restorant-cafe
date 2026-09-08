# AUDIT REPORT — Multi-Branch & Customer Note

> Generated: 2026-09-08
> Scope: Scope A (Multi-Cabang/Branch) + Scope B (Customer Note on Order Card)

---

## DAFTAR ISI

1. [Current Architecture](#1-current-architecture)
2. [Existing Tenant Isolation](#2-existing-tenant-isolation)
3. [Branch Design](#3-branch-design)
4. [Tables/Models yang Perlu Branch Scope](#4-tablesmodels-yang-perlu-branch-scope)
5. [Tables/Models yang TIDAK Perlu branchId](#5-tablesmodels-yang-tidak-perlu-branchid)
6. [Migration Strategy](#6-migration-strategy)
7. [Backfill Strategy](#7-backfill-strategy)
8. [RBAC / Branch Authorization](#8-rbac--branch-authorization)
9. [QR / Table Strategy](#9-qr--table-strategy)
10. [Product Strategy](#10-product-strategy)
11. [Payment Strategy](#11-payment-strategy)
12. [Report Strategy](#12-report-strategy)
13. [Promo Strategy](#13-promo-strategy)
14. [Recommendation Strategy](#14-recommendation-strategy)
15. [Customer Note — Existing Field / New Field](#15-customer-note--existing-field--new-field)
16. [API Changes](#16-api-changes)
17. [UI Changes](#17-ui-changes)
18. [Security Risks](#18-security-risks)
19. [Backward Compatibility](#19-backward-compatibility)
20. [Test Matrix](#20-test-matrix)

---

## 1. CURRENT ARCHITECTURE

### Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.3.3 (App Router, TypeScript) |
| Database | MySQL 8 / MariaDB via Prisma 7 |
| Auth (Staff) | NextAuth v5 beta (Credentials + JWT) |
| Auth (Customer) | Custom httpOnly cookie session |
| Payments | iPaymu v2 (VA + QRIS), KASIR Cash, KASIR QRIS |
| WhatsApp | Baileys via BullMQ + Redis |
| Realtime | Server-Sent Events (in-memory bus) |
| UI | React 19, Tailwind CSS v4, shadcn-style components |

### Prisma Models (24 total)

| Model | Purpose | Has `restaurantId` |
|-------|---------|-------------------|
| `Restaurant` | Tenant root | N/A (IS the tenant) |
| `RestaurantSettings` | Branding/colors/logo | via `restaurantId` FK |
| `User` | Staff (ADMIN/CASHIER) | Yes |
| `Table` | Physical tables | Yes |
| `Category` | Menu categories | Yes |
| `Product` | Menu items | Yes |
| `ProductOptionGroup` | Product option groups | No (via Product) |
| `ProductOption` | Individual options | No (via Group → Product) |
| `ProductAddon` | Product addons | No (via Product) |
| `ProductRecommendation` | Admin-curated recs | Yes |
| `Customer` | Customer accounts | Yes |
| `Order` | Orders | Yes |
| `OrderItem` | Line items | No (via Order) |
| `OrderStatusHistory` | Status audit trail | No (via Order) |
| `Payment` | Payment records | Yes |
| `PaymentTransaction` | Payment audit rows | No (via Payment) |
| `Promo` | Discount codes | Yes |
| `PromoUsage` | Claim/use tracking | No (via Promo) |
| `CashierShift` | Cash drawer sessions | Yes |
| `ShiftOverride` | Shift override requests | Yes |
| `Refund` | Refund requests | Yes |
| `CancellationRequest` | Cancellation requests | Yes |
| `AuditLog` | Audit trail | Yes |
| `WhatsAppMessage` | WA message log | Yes |
| `WhatsAppSession` | WA connection state | Yes |
| `Notification` | In-app notifications | Yes |

### Enums (9)

`Role` (ADMIN, CASHIER), `ShiftStatus`, `RequestStatus`, `OrderStatus`, `OrderType`, `PaymentStatus`, `TableStatus`, `NotificationType`, `WhatsAppConnectionStatus`

### API Routes (80 files, ~100 handlers)

- **Admin/Staff routes**: Authenticated via NextAuth session, `restaurantId` derived from JWT
- **Public routes**: No auth or customer session, `restaurantId` from query/body with server-side validation

### Auth Flow (Staff)

```
NextAuth Credentials → JWT (role, sessionVersion)
→ requireAuth() → requireRestaurantContext() → { userId, restaurantId, role }
→ requireRoles(["ADMIN","CASHIER"]) or requireAdmin()
→ requireAdmin() + verifyAdminPassword() (sensitive ops)
```

**Key file**: `src/lib/auth-helpers.ts` — ALL admin/staff routes derive `restaurantId` from session.

---

## 2. EXISTING TENANT ISOLATION

### What Exists

- **Every operational model** carries `restaurantId` as FK
- **All service queries** filter by `restaurantId` in WHERE clause
- **All admin routes** derive `restaurantId` from server-side session (never from client)
- **Unique constraints** are restaurant-scoped: `[restaurantId, number]` (Table), `[restaurantId, orderNumber]` (Order), `[restaurantId, code]` (Promo), `[restaurantId, name]` (Category), `[restaurantId, phone]` (Customer)
- **Customer auth** is restaurant-scoped (session cookie contains `restaurantId`)
- **File uploads** stored under `/uploads/products/<restaurantId>/` and `/uploads/branding/<restaurantId>/`
- **WhatsApp sessions** keyed by `restaurantId`

### What Does NOT Exist

- **No Branch model** anywhere in schema or code
- **No `branchId`** field on any model
- **No branch filtering** in any service
- **No branch selector** in any UI
- **No branch context** in QR codes or table resolution
- **No multi-user-per-branch** concept (User → Restaurant is 1:1 via `restaurantId`)

### Isolation Quality

Current isolation is **restaurant-level only** and is **solid**. Every query is anchored on `restaurantId` from a server-trusted source. There are no client-trusted `restaurantId` values in admin routes.

---

## 3. BRANCH DESIGN

### Concept

```
Restaurant / Brand (tenant root — unchanged)
    ├── Branch "Jakarta" (code: JKT)
    ├── Branch "Bandung" (code: BDG)
    └── Branch "Surabaya" (code: SUB)
```

Branch is a **second organizational layer** beneath Restaurant. It does NOT replace `restaurantId`.

### Branch Model

```prisma
model Branch {
  id             String   @id @default(cuid())
  restaurantId   String
  code           String   // e.g., "JKT", "BDG"
  name           String   // e.g., "Jakarta Pusat"
  address        String?
  phone          String?
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  restaurant     Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  // Relations
  tables         Table[]
  orders         Order[]
  shifts         CashierShift[]
  users          UserBranch[]

  @@unique([restaurantId, code])
  @@index([restaurantId])
  @@index([isActive])
}
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Branch is below Restaurant | Yes | Restaurant = brand/tenant. Branch = physical outlet. |
| Unique constraint | `[restaurantId, code]` | Code is short identifier (JKT, BDG). Name can duplicate across restaurants. |
| Branch as separate table | Yes | NOT a field on Restaurant. Prevents denormalization. |
| Default branch for existing data | Yes | `Main Outlet` (code: `MAIN`) created during migration. |
| Branch required for all operational data | Eventually yes | Phase approach: nullable first, then enforce. |

---

## 4. TABLES/MODELS YANG PERLU BRANCH SCOPE

These models represent **operational data that varies per physical location**.

### Tier 1 — CRITICAL (must have `branchId`)

| Model | Current Scoping | Branch Strategy | Notes |
|-------|----------------|-----------------|-------|
| `Table` | `restaurantId` | Add `branchId` | Tables are physical, per-location. `number` unique per `[restaurantId, branchId]`. |
| `Order` | `restaurantId` | Add `branchId` | Orders happen at a specific branch. |
| `Payment` | `restaurantId` | Via Order relation | Payment belongs to Order → inherits branch from Order. No direct `branchId` needed if always accessed through Order. But add for query convenience + direct listing. |
| `CashierShift` | `restaurantId` | Add `branchId` | Shifts are per-cashier-per-branch. |
| `ShiftOverride` | `restaurantId` | Via Shift relation | Inherits from CashierShift. Add for query convenience. |
| `Refund` | `restaurantId` | Via Order relation | Refund is for an Order at a branch. Add `branchId` for reporting/filtering. |
| `CancellationRequest` | `restaurantId` | Via Order relation | Same as Refund. |
| `AuditLog` | `restaurantId` | Add `branchId` | Audit trail should record which branch. |

### Tier 2 — CONDITIONAL (branch scope depends on business rule)

| Model | Current Scoping | Branch Strategy | Notes |
|-------|----------------|-----------------|-------|
| `Product` | `restaurantId` | **DO NOT add `branchId`** | Products are shared master data. Branch availability/price via junction table (see §10). |
| `Category` | `restaurantId` | **DO NOT add `branchId`** | Categories are shared. Same menu structure across branches. |
| `Promo` | `restaurantId` | Add nullable `branchId` | `null` = all branches, specific = branch-only. |
| `PromoUsage` | via Promo | Add `branchId` | Track which branch the promo was used at. |
| `ProductRecommendation` | `restaurantId` | **DO NOT add `branchId`** | Admin-curated, restaurant-level. Recommendation engine already filters by product availability. |
| `Customer` | `restaurantId` | **DO NOT add `branchId`** | Customer account is restaurant-level. Orders from different branches are linked via Order.branchId. |
| `Notification` | `restaurantId` | Add `branchId` | Notifications should be branch-scoped for filtering. |

### Tier 3 — NO CHANGE NEEDED

| Model | Reason |
|-------|--------|
| `Restaurant` | Tenant root. No branch scope. |
| `RestaurantSettings` | Branding is restaurant-level (Phase 1). |
| `User` | User assignment to branches via `UserBranch` junction (see §8). |
| `OrderItem` | Belongs to Order → inherits branch from parent. |
| `OrderStatusHistory` | Belongs to Order → inherits branch from parent. |
| `PaymentTransaction` | Belongs to Payment → inherits branch from parent. |
| `ProductOptionGroup` | Belongs to Product → shared. |
| `ProductOption` | Belongs to OptionGroup → shared. |
| `ProductAddon` | Belongs to Product → shared. |
| `WhatsAppMessage` | Restaurant-level communication log. |
| `WhatsAppSession` | One WA connection per restaurant. |

---

## 5. TABLES/MODELS YANG TIDAK PERLU branchId

Explicitly listed for clarity:

| Model | Reason NOT to add `branchId` |
|-------|------------------------------|
| `Restaurant` | IS the tenant root |
| `RestaurantSettings` | Restaurant-level branding (Phase 1) |
| `Product` | Shared master data. Branch availability via junction table. |
| `Category` | Shared menu structure |
| `ProductOptionGroup` | Shared (via Product) |
| `ProductOption` | Shared (via OptionGroup) |
| `ProductAddon` | Shared (via Product) |
| `ProductRecommendation` | Admin-curated, restaurant-level |
| `Customer` | Restaurant-level account. History comes from Order.branchId. |
| `OrderItem` | Via Order parent |
| `OrderStatusHistory` | Via Order parent |
| `PaymentTransaction` | Via Payment parent |
| `WhatsAppMessage` | Restaurant-level |
| `WhatsAppSession` | Restaurant-level (one WA per restaurant) |

---

## 6. MIGRATION STRATEGY

### Principle: Additive Only, Zero Downtime

All migrations must be backward-compatible. Existing data must continue to work.

### Step-by-Step Migration Plan

#### Phase M1: Create Branch Infrastructure

```sql
-- 1. Create Branch table
CREATE TABLE `branch` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `address` VARCHAR(191) NULL,
  `phone` VARCHAR(191) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `branch_restaurantId_code_key` (`restaurantId`, `code`),
  INDEX `branch_restaurantId_idx` (`restaurantId`),
  INDEX `branch_isActive_idx` (`isActive`),
  CONSTRAINT `branch_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE CASCADE
);

-- 2. Create UserBranch junction table
CREATE TABLE `userbranch` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `userbranch_userId_branchId_key` (`userId`, `branchId`),
  CONSTRAINT `userbranch_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE,
  CONSTRAINT `userbranch_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE CASCADE
);

-- 3. Create BranchProduct junction table (for per-branch availability/price)
CREATE TABLE `branchproduct` (
  `id` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `isAvailable` BOOLEAN NOT NULL DEFAULT true,
  `priceOverride` DECIMAL(10,2) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `branchproduct_branchId_productId_key` (`branchId`, `productId`),
  CONSTRAINT `branchproduct_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE CASCADE,
  CONSTRAINT `branchproduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE
);
```

#### Phase M2: Add Nullable `branchId` to Operational Tables

```sql
-- Add nullable branchId to operational tables
ALTER TABLE `table` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `order` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `payment` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `cashiershift` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `shiftoverride` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `refund` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `cancellationrequest` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `auditlog` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `notification` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `promousage` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `promo` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- Add foreign keys
ALTER TABLE `table` ADD CONSTRAINT `table_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `order` ADD CONSTRAINT `order_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `payment` ADD CONSTRAINT `payment_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `cashiershift` ADD CONSTRAINT `cashiershift_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `shiftoverride` ADD CONSTRAINT `shiftoverride_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `refund` ADD CONSTRAINT `refund_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `cancellationrequest` ADD CONSTRAINT `cancellationrequest_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `auditlog` ADD CONSTRAINT `auditlog_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `notification` ADD CONSTRAINT `notification_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `promousage` ADD CONSTRAINT `promousage_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;
ALTER TABLE `promo` ADD CONSTRAINT `promo_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL;

-- Add indexes
ALTER TABLE `table` ADD INDEX `table_branchId_idx` (`branchId`);
ALTER TABLE `order` ADD INDEX `order_branchId_idx` (`branchId`);
ALTER TABLE `payment` ADD INDEX `payment_branchId_idx` (`branchId`);
ALTER TABLE `cashiershift` ADD INDEX `cashiershift_branchId_idx` (`branchId`);
ALTER TABLE `auditlog` ADD INDEX `auditlog_branchId_idx` (`branchId`);
ALTER TABLE `notification` ADD INDEX `notification_branchId_idx` (`branchId`);
ALTER TABLE `promo` ADD INDEX `promo_branchId_idx` (`branchId`);
```

#### Phase M3: Update Unique Constraints (after backfill)

```sql
-- Update Table unique constraint: number must be unique per branch, not per restaurant
-- Step 1: Drop old unique
ALTER TABLE `table` DROP INDEX `table_restaurantId_number_key`;
-- Step 2: Add new unique (after backfill ensures no duplicates)
ALTER TABLE `table` ADD UNIQUE INDEX `table_restaurantId_branchId_number_key` (`restaurantId`, `branchId`, `number`);
```

**IMPORTANT**: Only run Phase M3 after Phase M2 backfill is complete and validated.

---

## 7. BACKFILL STRATEGY

### Principle: Create Default Branch, Then Assign Existing Data

```sql
-- For each existing restaurant:
-- 1. Create default branch "Main Outlet" (code: MAIN)
-- 2. Backfill all operational data to Main Outlet
-- 3. Assign all existing users to Main Outlet
-- 4. Assign all existing products to Main Outlet (BranchProduct with isAvailable=true, priceOverride=null)
```

### Seed Script Logic

```typescript
// For each restaurant in the database:
async function backfillBranch(restaurantId: string) {
  // 1. Create default branch
  const mainBranch = await prisma.branch.create({
    data: {
      restaurantId,
      code: 'MAIN',
      name: 'Main Outlet',
      address: restaurant.address,
      phone: restaurant.phone,
      isActive: true,
    }
  });

  // 2. Backfill all operational tables
  await prisma.table.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.order.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.payment.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.cashierShift.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.shiftOverride.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.refund.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.cancellationRequest.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.auditLog.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.notification.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.promo.updateMany({ where: { restaurantId }, data: { branchId: mainBranch.id } });
  await prisma.promoUsage.updateMany({
    where: { promo: { restaurantId } },
    data: { branchId: mainBranch.id }
  });

  // 3. Assign all users to Main Outlet
  const users = await prisma.user.findMany({ where: { restaurantId } });
  for (const user of users) {
    await prisma.userBranch.create({
      data: { userId: user.id, branchId: mainBranch.id }
    });
  }

  // 4. Create BranchProduct entries for all active products
  const products = await prisma.product.findMany({ where: { restaurantId, isActive: true } });
  for (const product of products) {
    await prisma.branchProduct.create({
      data: {
        branchId: mainBranch.id,
        productId: product.id,
        isAvailable: product.isAvailable,
        priceOverride: null, // Use product's own price
      }
    });
  }
}
```

### Validation Queries (Post-Backfill)

```sql
-- Verify no operational data without branchId
SELECT 'orders_without_branch' AS check_name, COUNT(*) AS cnt FROM `order` WHERE branchId IS NULL
UNION ALL
SELECT 'tables_without_branch', COUNT(*) FROM `table` WHERE branchId IS NULL
UNION ALL
SELECT 'payments_without_branch', COUNT(*) FROM `payment` WHERE branchId IS NULL
UNION ALL
SELECT 'shifts_without_branch', COUNT(*) FROM `cashiershift` WHERE branchId IS NULL;

-- Verify all users assigned to at least one branch
SELECT u.id, u.name FROM user u
LEFT JOIN userbranch ub ON ub.userId = u.id
WHERE ub.id IS NULL AND u.restaurantId IS NOT NULL;
```

### When to Enforce NOT NULL

After backfill is validated and application code is updated to always provide `branchId`:
- Add NOT NULL constraints column by column
- Test each constraint in staging before production
- Never enforce before application code is deployed

---

## 8. RBAC / BRANCH AUTHORIZATION

### Current Role System

| Role | Access |
|------|--------|
| `ADMIN` | Full access to all restaurant data |
| `CASHIER` | Orders, payments, shifts (own), tables |

### Proposed User-Branch Assignment

```
User → UserBranch[] (many-to-many)
```

**Why junction table instead of `User.branchId`:**
- One user can access multiple branches (e.g., manager covering 2 locations)
- Owner/Admin may need to see all branches
- More flexible for future role expansion

### Branch Authorization Rules

| Role | Branch Scope |
|------|-------------|
| `ADMIN` with `UserBranch[] = all branches` | Sees all branches (aggregated or selectable) |
| `ADMIN` with `UserBranch[] = [JKT, BDG]` | Only sees Jakarta and Bandung |
| `CASHIER` with `UserBranch[] = [JKT]` | Only sees Jakarta |
| `CASHIER` with `UserBranch[] = [JKT, BDG]` | Can operate at assigned branches (but typically one at a time) |

### Backend Authorization Flow

```
requireAuth() → { userId, restaurantId, role }
→ getBranchContext(userId, requestedBranchId?) → validated branchId
→ Service queries filter by { restaurantId, branchId }
```

### Implementation Strategy

1. `requireBranchContext(req, branchId?)` — new helper in `src/lib/auth-helpers.ts`
   - If user is ADMIN and has no specific branch assignments → all branches (pass `branchId: undefined` = no filter)
   - If user has specific branch assignments → validate `branchId` is in their assignment list
   - If no branchId provided and user has assignments → use their first/default branch
2. Service layer receives `branchId` as a validated parameter, never from client
3. Client sends `branchId` in request header or body, but server ALWAYS validates against UserBranch

### Migration for User Roles

```sql
-- OWNER role (optional future enhancement)
-- For now, ADMIN with all-branch access serves as OWNER
-- Do NOT add new roles to the Role enum unless absolutely necessary
```

---

## 9. QR / TABLE STRATEGY

### Current Flow

```
Customer scans QR → /t/{tableNumber}
→ GET /api/public/tables/lookup?number={tableNumber}
→ Table found → restaurantId from table → set TableContext → /menu
```

**Problem**: Table number is only unique per `[restaurantId, number]`. With multi-branch, we need `[restaurantId, branchId, number]`.

### Proposed QR Format

```
/t/{branchCode}/{tableNumber}
```

Examples:
```
/t/JKT/01    → Jakarta branch, Table 01
/t/BDG/01    → Bandung branch, Table 01
/t/MAIN/01   → Main Outlet, Table 01
```

### Table Lookup Resolution

```typescript
// New public endpoint: /api/public/tables/lookup
// Query: ?branchCode=JKT&number=01

// Resolution:
const branch = await prisma.branch.findFirst({
  where: { restaurant: { isActive: true }, code: branchCode, isActive: true }
});
const table = await prisma.table.findFirst({
  where: { restaurantId: branch.restaurantId, branchId: branch.id, number: tableNumber, isActive: true }
});
// Return table + branch context
```

### Backward Compatibility for Existing QR Codes

**Existing QR codes encode**: `/t/{tableNumber}` (no branch)

**Strategy**: 
1. During migration, existing tables get `branchId = Main Outlet`
2. `/t/{tableNumber}` lookup falls back to: if only ONE table with that number exists across all branches → resolve it
3. If table number exists in multiple branches → return error asking for branch-specific QR
4. New QR codes should be regenerated with `/t/{branchCode}/{tableNumber}` format
5. Admin UI shows both old and new QR format; recommends regeneration

### QR Generation (Admin)

When admin generates QR for a table:
```
URL: ${origin}/t/${branch.code}/${table.number}
```

### Public Table Lookup API Changes

```typescript
// GET /api/public/tables/lookup
// Old: ?number=01
// New: ?branchCode=JKT&number=01 (preferred)
// Fallback: ?number=01 (backward compatible, with branch disambiguation logic)
```

---

## 10. PRODUCT STRATEGY

### Design: Shared Master + Branch Availability/Price

Products are **NOT duplicated per branch**. Instead:

```
Restaurant
  └── Product (master data — shared across all branches)
        ├── BranchProduct (branchId, productId) → isAvailable, priceOverride
        └── ...
```

### BranchProduct Model

```prisma
model BranchProduct {
  id             String   @id @default(cuid())
  branchId       String
  productId      String
  isAvailable    Boolean  @default(true)
  priceOverride  Decimal? @db.Decimal(10, 2)  // null = use product.price
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  branch  Branch @relation(fields: [branchId], references: [id], onDelete: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([branchId, productId])
  @@index([branchId])
  @@index([productId])
}
```

### Resolution Logic

```typescript
function getEffectivePrice(product: Product, branchProduct: BranchProduct | null): number {
  return branchProduct?.priceOverride ?? product.price;
}

function isAvailableAtBranch(product: Product, branchProduct: BranchProduct | null): boolean {
  // If no BranchProduct record exists, product is available by default
  // (backward compatibility with single-branch or unconfigured products)
  return branchProduct?.isAvailable ?? product.isAvailable;
}
```

### Admin Flow

- Products page shows ALL products for the restaurant
- Toggle availability PER BRANCH (if multiple branches exist)
- Price override per branch (optional)
- If only one branch → behaves exactly like today (no BranchProduct needed)

### Public Menu Flow

```typescript
// GET /api/public/menu?restaurantId=X&branchCode=JKT
// 1. Resolve branch
// 2. Fetch products for restaurant
// 3. Join with BranchProduct for that branch
// 4. Filter: only show products where isAvailableAtBranch = true
// 5. Apply price override where applicable
```

### What Stays the Same

- Product name, description, imageUrl, category → restaurant-level
- ProductOptionGroup, ProductOption, ProductAddon → shared across branches
- Product image uploads → stored under `/uploads/products/<restaurantId>/`
- Category structure → shared

---

## 11. PAYMENT STRATEGY

### Principle: Payment follows its Order's branch

```
Order.restaurantId = A
Order.branchId = JKT
→ Payment.restaurantId = A
→ Payment.branchId = JKT (for query convenience)
```

### Implementation

1. When creating a payment, copy `branchId` from the parent Order
2. When listing payments (admin/kasir), filter by `branchId` from user's branch context
3. KASIR cash collection validates that the order+payment belongs to cashier's active branch
4. Barcode scanner: scan `ORD-XXXXXX` → resolve order → validate order.branchId matches cashier's current branch

### Payment Methods (Unchanged)

| Method | Flow | Branch Impact |
|--------|------|---------------|
| CUSTOMER QRIS | iPaymu gateway | None — payment URL sent to customer |
| KASIR CASH | Cashier marks paid | Must be at same branch as order |
| KASIR QRIS | Cashier creates QR | Must be at same branch as order |

### Webhook Handling

```typescript
// Webhook from iPaymu → find payment by providerRef
// payment.branchId is already set from when payment was created
// No change needed — webhook resolves via payment record
```

---

## 12. REPORT STRATEGY

### Current Report Features

- Revenue (period-based)
- Total orders
- Payment breakdown (by method, by status)
- Order type breakdown
- Best products
- Busiest hours
- CSV export

### Branch-Scoped Reports

All report queries add `branchId` filter:

```typescript
// Current:
const soldOrderWhere = { restaurantId, createdAt: range, status: { not: 'CANCELLED' }, paymentStatus: 'PAID' };

// New:
const soldOrderWhere = { restaurantId, branchId, createdAt: range, status: { not: 'CANCELLED' }, paymentStatus: 'PAID' };
```

### Report UI Filter

```
┌─────────────────────────────────────┐
│ Branch: [Semua Cabang ▼]            │
│ Periode: [01 Sep - 30 Sep]         │
│ [Terapkan]                          │
└─────────────────────────────────────┘
```

When `branchId` is `null`/undefined → aggregate across ALL branches (Semua Cabang).

### CSV Export

Add `Branch` column to CSV export rows. Filter same as report.

### Report Service Changes

```typescript
// src/services/report/report.service.ts
// Add branchId parameter to getSalesReport and getSalesOrdersForExport
// branchId is optional — null means "all branches"
```

---

## 13. PROMO STRATEGY

### Design: Optional Branch Scope

```prisma
model Promo {
  // ... existing fields ...
  branchId  String?   // null = restaurant-wide, specific = branch-only
  branch    Branch?   @relation(...)
}
```

### Business Rules

| Promo.branchId | Behavior |
|---------------|----------|
| `null` | Applies to ALL branches |
| Specific branchId | Only applies at that branch |

### Validation Logic

```typescript
// During promo validation/claim/apply:
if (promo.branchId !== null && promo.branchId !== order.branchId) {
  throw new Error('Promo not available at this branch');
}
```

### Admin UI

- When creating promo: optional branch selector ("Semua Cabang" or specific branch)
- When listing promos: show which branch(s) it applies to

### PromoUsage

Track `branchId` on PromoUsage for reporting (which branch drove the promo usage).

---

## 14. RECOMMENDATION STRATEGY

### Current Implementation

Recommendation engine tiers:
1. Manual (admin-curated `ProductRecommendation`)
2. Personalized favorites (customer's past orders)
3. Frequently bought together
4. Best sellers
5. Fallback (random active products)

### Branch-Aware Recommendations

**Recommendations should respect product availability at the branch:**

```typescript
// When fetching recommendations for a branch:
// 1. Filter out products not available at that branch (via BranchProduct)
// 2. Best sellers aggregation → add branchId filter
// 3. Bought together → only from orders at that branch
// 4. Customer favorites → orders across ALL branches (customer sees their full history)
// 5. Manual recs → show if product is available at branch, skip if not
```

### Design Decision

| Tier | Branch Scope | Rationale |
|------|-------------|-----------|
| Manual (admin recs) | Filter by branch availability | If product not available at branch, don't recommend |
| Personalized | Global (all branches) | Customer's taste preferences are global |
| Bought together | Branch-specific | Buying patterns may differ per location |
| Best sellers | Branch-specific | Popular items vary by location |
| Fallback | Branch-specific | Available products at branch only |

---

## 15. CUSTOMER NOTE — EXISTING FIELD / NEW FIELD

### Current State

**Order model already has a `notes` field:**

```prisma
model Order {
  // ...
  notes  String? @db.Text
  // ...
}
```

**OrderItem also has `notes`:**

```prisma
model OrderItem {
  // ...
  notes          String? @db.Text
  customizations Json?
  // ...
}
```

### Existing Field Usage Analysis

| Field | Written by | Read by | Notes |
|-------|-----------|---------|-------|
| `Order.notes` | Customer checkout (`use-cart.tsx` → checkout → API) | `order-detail.tsx` (admin) | This IS the customer note |
| `OrderItem.notes` | Cart item note field | `order-detail.tsx` (admin item list) | Per-item note (e.g., "no onions on this item") |
| `OrderItem.customizations.notes` | Cart → order creation | `order-card.tsx` (admin card) | Duplicate of notes stored in customizations JSON |

### FINDING: Customer note already exists as `Order.notes`

**Do NOT create a new field.** `Order.notes` is the customer note.

### ISSUE: Inconsistent Rendering

| Component | Shows `Order.notes`? | Shows `OrderItem.notes`? | Shows `customizations.notes`? |
|-----------|---------------------|-------------------------|------------------------------|
| `order-card.tsx` (admin card) | **NO** | **NO** | YES (line 296-300) |
| `order-detail.tsx` (admin detail) | YES (lines 564-576) | YES (line 324-328) | **NO** |

### Fix Required

1. **`order-card.tsx`**: Add display of `Order.notes` (customer note) on the card
2. **`order-detail.tsx`**: Already shows `Order.notes` — no change needed
3. **Consistency**: Ensure both card and detail show the same note source

### Customer Note Display on Order Card

```tsx
{/* In order-card.tsx, after customer name, before items */}
{order.notes && (
  <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
    <p className="text-xs font-medium text-amber-700 mb-0.5">
      📝 Catatan Customer
    </p>
    <p className="text-sm text-amber-900 line-clamp-2">
      {order.notes}
    </p>
  </div>
)}
```

### Validation (Server-Side)

```typescript
// In order creation service:
// - Trim whitespace
// - Max length: 500 characters
// - Optional (null/undefined = no note)
// - Type: string only
```

### API / Types

- `Order.notes` must be included in:
  - Admin order list DTO
  - Admin order detail DTO
  - Public order tracking DTO
- No new type needed — use existing `Order` type which already includes `notes`

---

## 16. API CHANGES

### New Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/api/admin/branches` | List branches | ADMIN |
| POST | `/api/admin/branches` | Create branch | ADMIN |
| GET | `/api/admin/branches/[id]` | Get branch detail | ADMIN |
| PUT | `/api/admin/branches/[id]` | Update branch | ADMIN |
| PATCH | `/api/admin/branches/[id]/status` | Toggle branch active | ADMIN |
| GET | `/api/admin/branches/[id]/products` | List branch products | ADMIN |
| PUT | `/api/admin/branches/[id]/products` | Update branch product availability/price | ADMIN |
| GET | `/api/auth/branch-context` | Get user's branch assignments + current branch | ADMIN/CASHIER |

### Modified Endpoints (Add `branchId` parameter)

| Endpoint | Change |
|----------|--------|
| `GET /api/orders` | Add optional `branchId` filter |
| `GET /api/payments` | Add optional `branchId` filter |
| `GET /api/shifts` | Add optional `branchId` filter |
| `GET /api/reports/sales` | Add optional `branchId` filter |
| `GET /api/reports/sales/export` | Add optional `branchId` filter |
| `GET /api/tables` | Add optional `branchId` filter |
| `GET /api/customers` | Add optional `branchId` filter |
| `GET /api/admin/promos` | Add optional `branchId` filter |
| `GET /api/public/menu` | Add `branchCode` parameter |
| `GET /api/public/tables/lookup` | Add `branchCode` parameter (with fallback) |
| `GET /api/public/tables` | Add `branchCode` parameter |
| `GET /api/public/promos` | Add `branchCode` parameter |
| `GET /api/public/menu/best-sellers` | Add `branchCode` parameter |
| `GET /api/public/menu/recommendations` | Add `branchCode` parameter |

### Modified Service Functions

| Service | Function | Change |
|---------|----------|--------|
| `order.service.ts` | `getOrders` | Add `branchId?` param |
| `order.service.ts` | `getOrder` | Validate branch access |
| `order.service.ts` | `getDashboardStats` | Add `branchId?` param |
| `order.service.ts` | `createOrder` | Require `branchId` |
| `order.service.ts` | `createCustomerOrder` | Derive `branchId` from table |
| `payment.service.ts` | `getPayments` | Add `branchId?` param |
| `payment.service.ts` | `createPayment` | Copy `branchId` from order |
| `payment.service.ts` | `markCashierPaymentPaid` | Validate branch match |
| `table.service.ts` | `getTables` | Add `branchId?` param |
| `table.service.ts` | `createTable` | Require `branchId` |
| `table.service.ts` | `lookupTable` | Accept `branchCode` |
| `table.service.ts` | `generateQrCode` | Include branchCode in URL |
| `shift.service.ts` | All functions | Add `branchId` context |
| `report.service.ts` | `getSalesReport` | Add `branchId?` param |
| `report.service.ts` | `getSalesOrdersForExport` | Add `branchId?` param |
| `promo.service.ts` | All functions | Add branch validation |
| `menu.service.ts` | `getProducts` | Filter by branch availability |
| `recommendation.service.ts` | All public functions | Filter by branch product availability |
| `approval.service.ts` | All functions | Add `branchId` context |
| `customer.service.ts` | `getCustomers` | Add `branchId?` param (from orders) |
| `audit.service.ts` | `log` | Add `branchId` |
| `audit.service.ts` | `list` | Add `branchId?` param |

### Branch Context Header

Admin/staff requests should include branch context:

```
X-Branch-Id: <branchId>
```

Server validates this against the user's `UserBranch` assignments. If not provided:
- Admin with all-branch access → no filter (sees all)
- Admin/Cashier with specific assignments → use their default/first branch

---

## 17. UI CHANGES

### Admin — Branch Management (Settings)

New page: `/admin/settings/branches`

```
┌─────────────────────────────────────────────┐
│ Pengaturan > Cabang                          │
│                                              │
│ [+ Tambah Cabang]                            │
│                                              │
│ ┌─────────┬──────────┬────────────┬──────┐  │
│ │ Kode    │ Nama     │ Alamat     │ Aksi │  │
│ ├─────────┼──────────┼────────────┼──────┤  │
│ │ JKT     │ Jakarta  │ Jl. ...    │ ✏️ 👁 │  │
│ │ BDG     │ Bandung  │ Jl. ...    │ ✏️ 👁 │  │
│ │ MAIN    │ Main     │ Jl. ...    │ ✏️ 👁 │  │
│ └─────────┴──────────┴────────────┴──────┘  │
└─────────────────────────────────────────────┘
```

Form fields:
- Code (required, uppercase, max 10 chars)
- Name (required)
- Address (optional)
- Phone (optional)
- Active toggle

### Admin — Branch Selector (Header)

```
┌─────────────────────────────────────────────────────────┐
│ 🏪 Restoran A    [Jakarta ▼]    👤 Admin    [Keluar]   │
└─────────────────────────────────────────────────────────┘
```

- Stored in React context + httpOnly cookie (NOT localStorage for security)
- Server validates branch access on every request
- Only shown if user has multiple branch assignments

### Admin — Reports Page

Add branch filter:

```
┌─────────────────────────────────────┐
│ Cabang: [Semua Cabang ▼]            │
│ Periode: [01 Sep - 30 Sep]         │
│ [Terapkan]                          │
└─────────────────────────────────────┘
```

### Admin — Order Card (Customer Note)

Add customer note display on order card (see §15).

### Admin — Table QR Generation

Update QR generation to include branch code in URL.

### Customer — Table QR Landing

Support new `/t/{branchCode}/{tableNumber}` URL format with backward compatibility for old `/t/{tableNumber}`.

### Admin — Product Management

Add per-branch availability toggle (if multiple branches exist):

```
┌─────────────────────────────────────────────┐
│ Nasi Goreng - Ketersediaan per Cabang        │
│                                              │
│ [✓] Jakarta  - Tersedia   Harga: Rp25.000   │
│ [✓] Bandung  - Tersedia   Harga: Rp27.000   │
│ [ ] Surabaya - Tidak Tersedia               │
└─────────────────────────────────────────────┘
```

### Admin — Promo Management

Add optional branch selector when creating/editing promo.

---

## 18. SECURITY RISKS

### Risk 1: Cross-Branch Data Access (IDOR)

**Risk**: Cashier Jakarta accesses Bandung order data via API manipulation.

**Mitigation**: 
- Server-side branch validation on EVERY request
- `requireBranchContext()` validates `branchId` against `UserBranch` assignments
- Never trust `branchId` from client without server validation

### Risk 2: BranchId Spoofing

**Risk**: Client sends `branchId` of a branch they don't have access to.

**Mitigation**:
- Server derives branch access from `UserBranch` table, not from request
- `X-Branch-Id` header is a HINT, server validates and may override
- All service functions receive validated `branchId` from auth helper

### Risk 3: QR Code Branch Confusion

**Risk**: Old QR code without branch context resolves to wrong branch.

**Mitigation**:
- Fallback logic only works when table number is unique across branches
- If ambiguous → error message with instructions
- Admin UI encourages QR regeneration with branch code

### Risk 4: Promo Cross-Branch Abuse

**Risk**: Customer uses Jakarta-only promo at Bandung.

**Mitigation**:
- Promo validation checks `branchId` match (or null for restaurant-wide)
- Checkout flow validates branch context before applying promo

### Risk 5: Report Data Leakage

**Risk**: Admin of one branch sees another branch's financial data.

**Mitigation**:
- Report API filters by validated `branchId`
- "Semua Cabang" only available to ADMIN with full branch access
- Branch-scoped admin users cannot access aggregated reports

### Risk 6: WebSocket/SSE Branch Leakage

**Risk**: SSE stream sends events from all branches to a branch-scoped user.

**Mitigation**:
- SSE connection includes branch context
- Event filtering adds `branchId` to event bus
- Only send events relevant to the user's assigned branch(es)

---

## 19. BACKWARD COMPATIBILITY

### QR Codes

| Format | Status | Behavior |
|--------|--------|----------|
| `/t/{tableNumber}` | Legacy | Works if table number is unique across branches. Otherwise error with guidance. |
| `/t/{branchCode}/{tableNumber}` | New standard | Always works. Primary format going forward. |

### API Endpoints

| Endpoint | Backward Compatible? | Notes |
|----------|---------------------|-------|
| All existing admin endpoints | YES | `branchId` is optional initially. Null = no branch filter. |
| Public menu/table endpoints | YES | Old params still work. New params preferred. |
| Order creation | YES | `branchId` derived from table (which has `branchId`). |

### Database

| Change | Compatible? | Notes |
|--------|-------------|-------|
| New `Branch` table | YES | Additive only |
| Nullable `branchId` columns | YES | Existing rows get `NULL` initially, backfilled later |
| `BranchProduct` table | YES | Additive only |
| `UserBranch` table | YES | Additive only |
| Unique constraint change on `Table` | **BREAKING** | Must be done AFTER backfill. Staged rollout. |

### Existing Flows (Unchanged)

| Flow | Impact |
|------|--------|
| Customer QRIS payment | NONE — payment flow unchanged |
| KASIR CASH | Additive — just adds branch context |
| KASIR QRIS | Additive — just adds branch context |
| Barcode scanner | Additive — validates branch match |
| Voucher/promo | Additive — adds branch filter |
| Recommendation | Additive — filters by branch availability |
| Report | Additive — adds branch filter option |
| Branding | NONE — stays restaurant-level |
| Table QR | Backward compatible with fallback |
| Print bill | NONE — unchanged |
| WhatsApp notifications | NONE — unchanged |
| Auth | Additive — adds branch context |

---

## 20. TEST MATRIX

### Branch Tests

```bash
# 1. Branch CRUD
- Create branch "Jakarta" (code: JKT)
- Create branch "Bandung" (code: BDG)
- Edit branch name
- Toggle branch active/inactive
- Verify unique constraint: duplicate code rejected

# 2. Data Isolation
- Create Table JKT-01 and Table BDG-01
- Verify JKT table appears only in Jakarta context
- Create Order at Jakarta branch
- Verify order has correct branchId
- Create Order at Bandung branch
- Verify isolation

# 3. Cashier Branch Access
- Login as Cashier assigned to Jakarta
- Verify: can see Jakarta orders
- Verify: CANNOT see Bandung orders
- Attempt to create order with Bandung table → rejected

# 4. Admin Multi-Branch Access
- Login as Admin with all-branch access
- Verify: can see all branches in selector
- Verify: can filter reports by branch
- Verify: can see "Semua Cabang" aggregated data

# 5. QR Codes
- Generate QR for Jakarta Table 01 → URL: /t/JKT/01
- Generate QR for Bandung Table 01 → URL: /t/BDG/01
- Scan Jakarta QR → resolves to Jakarta table
- Scan Bandung QR → resolves to Bandung table
- Test legacy QR /t/01 (if unique) → resolves correctly
- Test legacy QR /t/01 (if exists in multiple) → error

# 6. Reports
- Generate report for "Semua Cabang"
- Generate report for Jakarta only
- Generate report for Bandung only
- Verify totals are correct (no double counting)
- Export CSV with branch filter

# 7. Promo
- Create restaurant-wide promo (branchId = null)
- Create Jakarta-only promo
- Attempt to use Jakarta promo at Bandung → rejected
- Attempt to use restaurant-wide promo at any branch → success

# 8. Product Availability
- Product "Nasi Goreng" available at Jakarta, unavailable at Bandung
- Menu API for Jakarta → shows Nasi Goreng
- Menu API for Bandung → hides Nasi Goreng
- Price override: Jakarta Rp25.000, Bandung Rp27.000

# 9. Existing Data Migration
- Verify all existing data assigned to Main Outlet (MAIN)
- Verify existing orders still accessible
- Verify existing tables still work
- Verify existing users can login
- Verify existing payments intact

# 10. Customer Note (Scope B)
- Create order WITHOUT note → card shows no note box
- Create order WITH short note → card shows note
- Create order WITH long note → card shows truncated note
- Verify note in order detail (full text)
- Test DINE_IN, TAKEAWAY, DELIVERY order types
```

### Regression Tests

```bash
# Mandatory regression
npx tsc --noEmit           # TypeScript compilation
npm run build              # Next.js build
npm run lint               # ESLint

# Feature regression
# - Customer QRIS flow → unchanged
# - KASIR CASH flow → unchanged (plus branch context)
# - KASIR QRIS flow → unchanged (plus branch context)
# - Barcode scanner → validates branch match
# - Voucher/promo → adds branch filter
# - Recommendation → filters by branch availability
# - Print bill → unchanged
# - Reports → adds branch filter, existing data intact
# - Branding → unchanged (restaurant-level)
# - Auth → adds branch context, existing roles work
# - WhatsApp → unchanged
# - SSE realtime → adds branch filtering
# - Refund/Cancellation → adds branch context
# - Shift/Kasir → adds branch context
```

### Customer Note Tests

```bash
# Note field tests
- Order without note → no empty box on card
- Order with note "Jangan pedas" → displays correctly
- Order with 500 char note → truncated on card, full in detail
- Order with whitespace-only note → treated as no note
- Order with note from DINE_IN → shows on card
- Order with note from TAKEAWAY → shows on card
- Order with note from DELIVERY → shows on card

# API tests
- POST /api/public/orders with notes → stored in Order.notes
- GET /api/orders → notes field present in response
- GET /api/orders/[id] → notes field present in response

# UI tests
- Admin order card: note visible (amber box, line-clamp-2)
- Kasir order card: note visible (same style)
- Order detail: note fully visible
- No regression in existing order card layout
```

---

## RINGKASAN KEPUTUSAN ARCHITECTURE

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Branch model | Tabel terpisah | Bukan field di Restaurant. Organisasi data lebih bersih. |
| Product per branch | Junction table (BranchProduct) | Shared master, per-branch availability/price. |
| User per branch | Junction table (UserBranch) | Satu user bisa akses banyak branch. |
| Customer scope | Restaurant-level | Akun customer tidak berubah. |
| Branding scope | Restaurant-level (Phase 1) | Tidak ada requirement branding per-branch. |
| Promo scope | Nullable branchId | Null = semua branch, spesifik = branch-only. |
| Recommendation | Branch-aware filtering | Rekomendasi menyesuaikan availability branch. |
| QR format | `/t/{branchCode}/{tableNumber}` | Backward compatible dengan fallback. |
| Order number | Tidak diubah | Sudah globally unique (ORD-YYYYMMDD-XXXXXX). |
| Payment | Via Order relation + direct branchId | Query convenience + enforcement. |
| Report | Optional branchId filter | Null = semua, spesifik = per-branch. |
| Customer note | Field existing `Order.notes` | Sudah ada. Jangan buat field baru. |
| Branch authorization | Server-side validation | Client branchId adalah hint, server validate via UserBranch. |
| Default branch | Main Outlet (MAIN) | Untuk data existing saat migration. |
| Migration approach | Additive only, nullable first | Zero downtime, backward compatible. |

---

## 21. IMPLEMENTATION STATUS (SCOPE A + B)

> Status: **SELESAI** — seluruh item Scope A dan Scope B diimplementasikan, `npx tsc --noEmit` dan `npm run build` lolos.

### Implemented — Backend / Schema

| Item | Status | File Utama |
|------|--------|-----------|
| `Branch`, `UserBranch`, `BranchProduct` models | DONE | `prisma/schema.prisma` + `prisma/migrations/...add_branch_multi_cabang/` |
| Kolom `branchId` di operasional (Order, Table, Payment, Shift, ShiftOverride, Refund, CancellationRequest, AuditLog, Notification, Promo, PromoUsage) | DONE | schema + migration |
| Unique constraint Table per `[restaurantId, branchId, number]` | DONE | `...table_unique_per_branch/` |
| Audit log `branchId` | DONE | `src/services/audit/audit.service.ts` + `src/app/api/audit/...` (query `...(branchId ? { branchId } : {})`) |
| Backfill script (default branch `MAIN`, assign user/product, backfill semua tabel) | DONE | `scripts/backfill-branch.ts` (sudah dijalankan di staging: 0 NULL branchId) |
| Client `branchService` CRUD + `BranchProductRow` + `x-branch-id` helper | DONE | `src/services/branch.service.ts`, `src/services/branch/`, `src/lib/axios.ts` |
| Auth helper `branchHintFrom(req)` + `requireRoles/branchScoped` + `ctx.branchId` ter-validasi | DONE | `src/lib/auth-helpers.ts` |
| Admin branch CRUD API | DONE | `src/app/api/admin/branches/**` |
| User-branch assignment API | DONE | `src/app/api/users/[userId]/branches/**` |
| Order/table/payment/shift/report service + routes branch-aware | DONE | `order.service.ts`, `table.service.ts`, `payment.service.ts`, `shift*.service.ts`, `report.service.ts` + route files |
| Approval (refund/cancellation) branch-aware — set dari `order.branchId`, guard order.scoped mismatch, audit branchId | DONE | `src/services/approval/approval.service.ts` + `src/app/api/refunds/**`, `src/app/api/cancellations/**` |
| Customer list branch-filtered (via `Order.branchId`) | DONE | `src/services/customer/customer.service.ts` + `src/app/api/customers/**` |
| Promo branch scope (`branchId` nullable, validasi `promo.branchId !== order.branchId`) + `PromoUsage.branchId` | DONE | `src/services/promo/promo.service.ts` + `src/app/api/admin/promos/**`, `src/app/api/public/promos/**`, `src/components/customer/promo-section.tsx` |
| Public menu/recommendation branch-aware (`loadProducts`/`getFallbackProducts` include `branchProducts`), best-sellers + recommendations terima `branchCode` | DONE | `src/services/recommendation/recommendation.service.ts`, `src/app/api/public/menu/route.ts`, `public/menu/best-sellers/route.ts`, `public/menu/recommendations/route.ts` |
| QR `/t/{branchCode}/{tableNumber}` + fallback legacy | DONE | `src/app/(customer)/t/[branchCode]/[tableNumber]/page.tsx`, `t/table-landing.tsx`, `src/app/api/public/tables/lookup/route.ts`, `src/app/api/tables/[id]/qr/route.ts` |
| Customer note Reader: `Order.notes` ditampilkan di order card | DONE | `src/components/admin/orders/order-card.tsx` (Scope B) |

### Implemented — UI (Admin)

| Item | Status | File |
|------|--------|------|
| Branch selector di header admin + context `use-branch-context` | DONE | `src/app/admin/layout.tsx`, `src/components/admin/branch-selector.tsx`, `src/hooks/use-branch-context.ts` |
| Users page — assign cabang per user (dialog + "Semua Cabang") | DONE | `src/app/admin/users/page.tsx` |
| Settings → Cabang CRUD page + nav + link settings | DONE | `src/app/admin/settings/branches/page.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/settings/page.tsx` |
| Marketing — branch selector saat buat promo + badge scope di kartu | DONE | `src/app/admin/marketing/page.tsx` |
| Menu — toggle availability/harga override per cabang (dialog) | DONE | `src/components/admin/branch-availability-dialog.tsx` + `src/app/admin/menu/page.tsx` |
| Order card customer note (amber box, `line-clamp-2`) | DONE | `src/components/admin/orders/order-card.tsx` |

### Validation Performed

```bash
npx tsc --noEmit    # ✔ clean
npx prisma generate # ✔
npm run build       # ✔ full build
```

### Known Notes / Boundaries

- `ProductRecommendation` dan `Customer` tetap restaurant-level (sesuai desain §4/§5).
- Detail pelanggan (`GET /api/customers/[id]`) tidak di-filter branch; hanya list yang di-filter (keputusan desain).
- `branchIds` kosong = akses semua cabang (semantics `requireRoles`); `branchScoped = true` hanya membatasi ke cabang ter-assign.
- Promo dengan `branchId = null` = berlaku semua cabang.
- Migration-ordering bug pre-existing (urutan migration promo) pada replay shadow DB → tetap gunakan `migrate diff` + apply manual bila perlu melakukan `migrate dev`.
