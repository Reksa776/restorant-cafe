-- Phase H3: quantity-based refund allocation (RefundItem)
-- Additive migration — no destructive changes, no data loss.
--
-- Creates ONLY the new `refunditem` table. Existing refund rows remain valid
-- as legacy amount-only refunds (no RefundItem rows) and fall back to the
-- pro-rata COGS reversal in reporting.

CREATE TABLE `refunditem` (
  `id` VARCHAR(191) NOT NULL,
  `refundId` VARCHAR(191) NOT NULL,
  `orderItemId` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `reversedCogs` DECIMAL(12, 2) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `refunditem_refundId_orderItemId_key` (`refundId`, `orderItemId`),
  INDEX `refunditem_refundId_idx` (`refundId`),
  INDEX `refunditem_orderItemId_idx` (`orderItemId`),
  CONSTRAINT `refunditem_refundId_fkey` FOREIGN KEY (`refundId`) REFERENCES `refund`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `refunditem_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `orderitem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
