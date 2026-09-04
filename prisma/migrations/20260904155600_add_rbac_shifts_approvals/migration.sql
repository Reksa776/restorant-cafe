-- AlterTable
ALTER TABLE `user` MODIFY `role` ENUM('ADMIN', 'CASHIER') NOT NULL DEFAULT 'ADMIN';

-- AlterTable
ALTER TABLE `payment` ADD COLUMN `shiftId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `cashiershift` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `shiftNumber` VARCHAR(191) NOT NULL,
    `openingCash` DECIMAL(12, 2) NOT NULL,
    `closingCash` DECIMAL(12, 2) NULL,
    `expectedCash` DECIMAL(12, 2) NULL,
    `difference` DECIMAL(12, 2) NULL,
    `notes` TEXT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cashiershift_restaurantId_idx`(`restaurantId`),
    INDEX `cashiershift_userId_idx`(`userId`),
    INDEX `cashiershift_status_idx`(`status`),
    UNIQUE INDEX `cashiershift_restaurantId_shiftNumber_key`(`restaurantId`, `shiftNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shiftoverride` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `requestedByCashierId` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `proposedClosingCash` DECIMAL(12, 2) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `approvedByAdminId` VARCHAR(191) NULL,
    `rejectedByAdminId` VARCHAR(191) NULL,
    `decisionNote` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `shiftoverride_restaurantId_idx`(`restaurantId`),
    INDEX `shiftoverride_shiftId_idx`(`shiftId`),
    INDEX `shiftoverride_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NULL,
    `shiftId` VARCHAR(191) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `requestedByCashierId` VARCHAR(191) NOT NULL,
    `approvedByAdminId` VARCHAR(191) NULL,
    `rejectedByAdminId` VARCHAR(191) NULL,
    `decisionNote` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `refund_restaurantId_idx`(`restaurantId`),
    INDEX `refund_orderId_idx`(`orderId`),
    INDEX `refund_paymentId_idx`(`paymentId`),
    INDEX `refund_shiftId_idx`(`shiftId`),
    INDEX `refund_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cancellationrequest` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `requestedByCashierId` VARCHAR(191) NOT NULL,
    `approvedByAdminId` VARCHAR(191) NULL,
    `rejectedByAdminId` VARCHAR(191) NULL,
    `decisionNote` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cancellationrequest_restaurantId_idx`(`restaurantId`),
    INDEX `cancellationrequest_orderId_idx`(`orderId`),
    INDEX `cancellationrequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auditlog` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `details` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `auditlog_restaurantId_idx`(`restaurantId`),
    INDEX `auditlog_userId_idx`(`userId`),
    INDEX `auditlog_action_idx`(`action`),
    INDEX `auditlog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `payment_shiftId_idx` ON `payment`(`shiftId`);

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `cashiershift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashiershift` ADD CONSTRAINT `cashiershift_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashiershift` ADD CONSTRAINT `cashiershift_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shiftoverride` ADD CONSTRAINT `shiftoverride_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shiftoverride` ADD CONSTRAINT `shiftoverride_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `cashiershift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shiftoverride` ADD CONSTRAINT `shiftoverride_requestedByCashierId_fkey` FOREIGN KEY (`requestedByCashierId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shiftoverride` ADD CONSTRAINT `shiftoverride_approvedByAdminId_fkey` FOREIGN KEY (`approvedByAdminId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shiftoverride` ADD CONSTRAINT `shiftoverride_rejectedByAdminId_fkey` FOREIGN KEY (`rejectedByAdminId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `cashiershift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_requestedByCashierId_fkey` FOREIGN KEY (`requestedByCashierId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_approvedByAdminId_fkey` FOREIGN KEY (`approvedByAdminId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_rejectedByAdminId_fkey` FOREIGN KEY (`rejectedByAdminId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellationrequest` ADD CONSTRAINT `cancellationrequest_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellationrequest` ADD CONSTRAINT `cancellationrequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellationrequest` ADD CONSTRAINT `cancellationrequest_requestedByCashierId_fkey` FOREIGN KEY (`requestedByCashierId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellationrequest` ADD CONSTRAINT `cancellationrequest_approvedByAdminId_fkey` FOREIGN KEY (`approvedByAdminId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellationrequest` ADD CONSTRAINT `cancellationrequest_rejectedByAdminId_fkey` FOREIGN KEY (`rejectedByAdminId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auditlog` ADD CONSTRAINT `auditlog_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auditlog` ADD CONSTRAINT `auditlog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

