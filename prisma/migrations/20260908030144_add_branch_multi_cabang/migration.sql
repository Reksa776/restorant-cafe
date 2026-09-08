-- AlterTable
ALTER TABLE `auditlog` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `cancellationrequest` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `cashiershift` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `notification` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `order` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `payment` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `promo` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `refund` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `shiftoverride` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `table` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- CreateTable
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

    INDEX `branch_restaurantId_idx`(`restaurantId`),
    INDEX `branch_isActive_idx`(`isActive`),
    UNIQUE INDEX `branch_restaurantId_code_key`(`restaurantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `userbranch` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `userbranch_userId_idx`(`userId`),
    INDEX `userbranch_branchId_idx`(`branchId`),
    UNIQUE INDEX `userbranch_userId_branchId_key`(`userId`, `branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branchproduct` (
    `id` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `priceOverride` DECIMAL(10, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `branchproduct_branchId_idx`(`branchId`),
    INDEX `branchproduct_productId_idx`(`productId`),
    UNIQUE INDEX `branchproduct_branchId_productId_key`(`branchId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `auditlog_branchId_idx` ON `auditlog`(`branchId`);

-- CreateIndex
CREATE INDEX `cancellationrequest_branchId_idx` ON `cancellationrequest`(`branchId`);

-- CreateIndex
CREATE INDEX `cashiershift_branchId_idx` ON `cashiershift`(`branchId`);

-- CreateIndex
CREATE INDEX `notification_branchId_idx` ON `notification`(`branchId`);

-- CreateIndex
CREATE INDEX `order_branchId_idx` ON `order`(`branchId`);

-- CreateIndex
CREATE INDEX `payment_branchId_idx` ON `payment`(`branchId`);

-- CreateIndex
CREATE INDEX `promo_branchId_idx` ON `promo`(`branchId`);

-- CreateIndex
CREATE INDEX `refund_branchId_idx` ON `refund`(`branchId`);

-- CreateIndex
CREATE INDEX `shiftoverride_branchId_idx` ON `shiftoverride`(`branchId`);

-- CreateIndex
CREATE INDEX `table_branchId_idx` ON `table`(`branchId`);

-- AddForeignKey
ALTER TABLE `branch` ADD CONSTRAINT `branch_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `userbranch` ADD CONSTRAINT `userbranch_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `userbranch` ADD CONSTRAINT `userbranch_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branchproduct` ADD CONSTRAINT `branchproduct_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branchproduct` ADD CONSTRAINT `branchproduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashiershift` ADD CONSTRAINT `cashiershift_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `table` ADD CONSTRAINT `table_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order` ADD CONSTRAINT `order_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promo` ADD CONSTRAINT `promo_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
