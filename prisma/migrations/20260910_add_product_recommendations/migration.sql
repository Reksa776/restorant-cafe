-- F3 — Admin-curated product recommendations (tenant-scoped).
-- Additive only: no existing tables/rows are dropped or modified.

CREATE TABLE `productrecommendation` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `recommendedProductId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    -- Explicit short name: auto-generated one exceeds MySQL's 64-char identifier limit.
    UNIQUE INDEX `product_reco_unique`(`restaurantId`, `productId`, `recommendedProductId`),
    INDEX `productrecommendation_restaurantId_idx`(`restaurantId`),
    INDEX `productrecommendation_productId_idx`(`productId`),
    INDEX `productrecommendation_recommendedProductId_idx`(`recommendedProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `productrecommendation`
    ADD CONSTRAINT `productrecommendation_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `productrecommendation`
    ADD CONSTRAINT `productrecommendation_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `product`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `productrecommendation`
    ADD CONSTRAINT `productrecommendation_recommendedProductId_fkey`
    FOREIGN KEY (`recommendedProductId`) REFERENCES `product`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;