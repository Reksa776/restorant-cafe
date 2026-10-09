-- ACCOUNTING — PHASE B: Expense Management
-- Additive migration — creates ONLY the new `expensecategory` and `expense`
-- tables (plus indexes and foreign keys). No existing table is altered,
-- dropped, or renamed, and no historical row is touched.
--
-- Scope note (documented in ACCOUNTING-PHASE-A-AUDIT.md): this is
-- OPERATIONAL expense tracking only — NOT a cashbook, journal, general
-- ledger, or P&L. Purchase is intentionally NOT recorded here: a purchase is
-- inventory (an asset) whose cost becomes COGS when the product is sold, so
-- also recording it as an expense would double-count it.
--
-- Tenant + branch isolation:
--   * every row carries `restaurantId` (tenant scope)
--   * every expense carries a required `branchId` (branch scope), mirroring
--     the existing `purchase` table
--   * `expensecategory` is restaurant-scoped with a per-tenant unique name
--     (`@@unique([restaurantId, name])`) so a category can never be shared
--     across tenants and cannot be duplicated within one tenant.
--
-- `method` is a MySQL ENUM (Prisma enum ExpenseMethod); `amount` is
-- DECIMAL(12, 2) — the same money precision as `purchase.total` and the
-- CashierShift cash columns. `spentAt` is the expense date (attribution date
-- used by every filter/report).

CREATE TABLE `expensecategory` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `expensecategory_restaurantId_name_key`(`restaurantId`, `name`),
    INDEX `expensecategory_restaurantId_idx`(`restaurantId`),
    INDEX `expensecategory_restaurantId_isActive_idx`(`restaurantId`, `isActive`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `expense` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `spentAt` DATETIME(3) NOT NULL,
    `method` ENUM('CASH', 'TRANSFER', 'QRIS', 'CARD', 'OTHER') NOT NULL DEFAULT 'CASH',
    `note` TEXT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `expense_restaurantId_spentAt_idx`(`restaurantId`, `spentAt`),
    INDEX `expense_restaurantId_branchId_spentAt_idx`(`restaurantId`, `branchId`, `spentAt`),
    INDEX `expense_restaurantId_categoryId_spentAt_idx`(`restaurantId`, `categoryId`, `spentAt`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `expensecategory` ADD CONSTRAINT `expensecategory_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `expense` ADD CONSTRAINT `expense_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `expense` ADD CONSTRAINT `expense_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `expense` ADD CONSTRAINT `expense_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `expensecategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `expense` ADD CONSTRAINT `expense_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
