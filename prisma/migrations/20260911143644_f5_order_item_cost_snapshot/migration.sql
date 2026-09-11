-- Phase F.5: Historical COGS snapshot (per OrderItem)
-- Additive migration — no destructive changes, no backfill.
-- Snapshot rows are written ONLY at the guarded READY -> COMPLETED order
-- transition (same transaction). Existing orders have no rows (LEGACY at
-- report level, never stored as a status row).

-- 1. New table: orderitemcostsnapshot (frozen per-OrderItem HPP)
--    orderItemId is UNIQUE (one-to-one) = exactly one snapshot per OrderItem;
--    second idempotency safety layer on top of the guarded status transition.
--    hppUnit / hppTotal are NULLABLE — incomplete cost statuses store NULL
--    (NO_RECIPE / MISSING_WAC / INACTIVE_INGREDIENT / NO_BRANCH), never 0.
--    onDelete: orderItem -> Cascade (deleting an order removes its lines AND
--    its snapshots together); branch -> SetNull (snapshot survives branch
--    hard-delete like Order.branch does); product -> Restrict (historical
--    financial data can never be silently destroyed by catalog changes).
CREATE TABLE `orderitemcostsnapshot` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `orderItemId` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NULL,
  `productId` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `hppUnit` DECIMAL(12,2) NULL,
  `hppTotal` DECIMAL(12,2) NULL,
  `status` ENUM('SNAPSHOTTED','NO_RECIPE','MISSING_WAC','INACTIVE_INGREDIENT','NO_BRANCH','LEGACY') NOT NULL,
  `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `orderitemcostsnapshot_orderItemId_key` (`orderItemId`),
  INDEX `orderitemcostsnapshot_orderId_idx` (`orderId`),
  INDEX `orderitemcostsnapshot_productId_idx` (`productId`),
  INDEX `orderitemcostsnapshot_completedAt_idx` (`completedAt`),
  INDEX `orderitemcostsnapshot_status_idx` (`status`),
  CONSTRAINT `orderitemcostsnapshot_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orderitemcostsnapshot_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orderitemcostsnapshot_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `orderitem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `orderitemcostsnapshot_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `orderitemcostsnapshot_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;