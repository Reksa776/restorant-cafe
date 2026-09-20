-- Phase FL: Cafe Floor Layout (visual geometry only) — Phase 1
-- Additive migration — no destructive changes, no data loss.
--
-- Creates ONLY two new tables (`tablelayout`, `tablelayoutitem`) and their
-- foreign keys. No existing table, column, or index is altered: Table,
-- Reservation, Order, Payment, QR data and every business row stay
-- untouched, so no existing engine changes behaviour.
--
-- `Table` remains the source of truth for table identity / capacity /
-- status / QR. `tablelayout` stores the branch-scoped floor board (one per
-- branch, enforced by the unique branchId), and `tablelayoutitem` stores
-- ONLY visual geometry (x/y/width/height/rotation/shape) in a logical
-- 900x600 canvas. Inherited fields (number/name/capacity/status/branchId)
-- are intentionally NOT duplicated here.

-- CreateTable
CREATE TABLE `tablelayout` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tablelayout_branchId_key`(`branchId`),
    INDEX `tablelayout_restaurantId_idx`(`restaurantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tablelayoutitem` (
    `id` VARCHAR(191) NOT NULL,
    `layoutId` VARCHAR(191) NOT NULL,
    `tableId` VARCHAR(191) NOT NULL,
    `x` DOUBLE NOT NULL,
    `y` DOUBLE NOT NULL,
    `width` DOUBLE NOT NULL,
    `height` DOUBLE NOT NULL,
    `rotation` DOUBLE NOT NULL DEFAULT 0,
    `shape` ENUM('RECTANGLE', 'CIRCLE') NOT NULL DEFAULT 'RECTANGLE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tablelayoutitem_tableId_key`(`tableId`),
    INDEX `tablelayoutitem_tableId_idx`(`tableId`),
    UNIQUE INDEX `tablelayoutitem_layoutId_tableId_key`(`layoutId`, `tableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tablelayout` ADD CONSTRAINT `tablelayout_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tablelayout` ADD CONSTRAINT `tablelayout_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tablelayoutitem` ADD CONSTRAINT `tablelayoutitem_layoutId_fkey` FOREIGN KEY (`layoutId`) REFERENCES `tablelayout`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tablelayoutitem` ADD CONSTRAINT `tablelayoutitem_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `table`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;