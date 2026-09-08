-- F3 — Customer login + Promo engine.
-- Additive only: no existing rows are dropped or modified. Guest customers
-- (no email/password) keep working exactly as before; Order.discount already
-- existed and is now actually populated when a promo is applied.

-- ------------------------------------------------------------
-- 1. Customer login fields (nullable → existing guests untouched)
-- ------------------------------------------------------------
ALTER TABLE `customer`
    ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `password` VARCHAR(191) NULL,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

-- Unique email per restaurant (NULLs never collide in MySQL).
ALTER TABLE `customer`
    ADD UNIQUE INDEX `customer_restaurantId_email_key`(`restaurantId`, `email`);

-- ------------------------------------------------------------
-- 2. Promo (tenant-scoped)
-- ------------------------------------------------------------
CREATE TABLE `promo` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'PERCENT',
    `value` DECIMAL(10, 2) NOT NULL,
    `minOrder` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `maxDiscount` DECIMAL(10, 2) NULL,
    `startsAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `maxUsage` INTEGER NOT NULL DEFAULT 0,
    `perCustomerLimit` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `promo_restaurantId_code_key`(`restaurantId`, `code`),
    INDEX `promo_restaurantId_idx`(`restaurantId`),
    INDEX `promo_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `promo`
    ADD CONSTRAINT `promo_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 3. PromoUsage (claim = orderId NULL, use = orderId set)
-- ------------------------------------------------------------
CREATE TABLE `promousage` (
    `id` VARCHAR(191) NOT NULL,
    `promoId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `promousage_promoId_idx`(`promoId`),
    INDEX `promousage_customerId_idx`(`customerId`),
    INDEX `promousage_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `promousage`
    ADD CONSTRAINT `promousage_promoId_fkey`
    FOREIGN KEY (`promoId`) REFERENCES `promo`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `promousage`
    ADD CONSTRAINT `promousage_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `promousage`
    ADD CONSTRAINT `promousage_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `order`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 4. Order promo columns (additive)
-- ------------------------------------------------------------
ALTER TABLE `order`
    ADD COLUMN `promoId` VARCHAR(191) NULL,
    ADD COLUMN `promoCode` VARCHAR(191) NULL;

ALTER TABLE `order`
    ADD CONSTRAINT `order_promoId_fkey`
    FOREIGN KEY (`promoId`) REFERENCES `promo`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;