-- Merchant Wallet & Payout — centralised (master merchant) settlement.
-- Purely additive: no existing table/column is altered. Tenants without a
-- wallet row get one created lazily by the application (getOrCreateWallet),
-- so existing merchants keep working without a data backfill.

CREATE TABLE `restaurantwallet` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `availableBalance` INTEGER NOT NULL DEFAULT 0,
  `pendingBalance` INTEGER NOT NULL DEFAULT 0,
  `totalEarned` INTEGER NOT NULL DEFAULT 0,
  `totalWithdrawn` INTEGER NOT NULL DEFAULT 0,
  `bankName` VARCHAR(191) NULL,
  `bankAccountNumber` VARCHAR(191) NULL,
  `bankAccountHolder` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `restaurantwallet_restaurantId_key` (`restaurantId`),
  INDEX `restaurantwallet_restaurantId_idx` (`restaurantId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `walletledger` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `type` ENUM('ORDER_CREDIT', 'WITHDRAWAL_HOLD', 'WITHDRAWAL_RELEASE', 'PLATFORM_FEE', 'ADJUSTMENT') NOT NULL,
  `amount` INTEGER NOT NULL,
  `balanceAfter` INTEGER NOT NULL,
  `referenceId` VARCHAR(191) NULL,
  `description` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- Hard idempotency backstop: one ORDER_CREDIT / PLATFORM_FEE per order and
  -- one WITHDRAWAL_RELEASE per withdrawal, even if two workers race.
  UNIQUE INDEX `walletledger_ref_unique` (`restaurantId`, `type`, `referenceId`),
  INDEX `walletledger_restaurantId_createdAt_idx` (`restaurantId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `withdrawalrequest` (
  `id` VARCHAR(191) NOT NULL,
  `withdrawalCode` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `amount` INTEGER NOT NULL,
  `feeAmount` INTEGER NOT NULL DEFAULT 0,
  `netAmount` INTEGER NOT NULL,
  `bankName` VARCHAR(191) NOT NULL,
  `bankAccountNumber` VARCHAR(191) NOT NULL,
  `bankAccountHolder` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `transferReference` VARCHAR(191) NULL,
  `rejectionReason` VARCHAR(191) NULL,
  `requestedByUserId` VARCHAR(191) NULL,
  `processedByEmail` VARCHAR(191) NULL,
  `processedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `withdrawalrequest_withdrawalCode_key` (`withdrawalCode`),
  INDEX `withdrawalrequest_restaurantId_status_idx` (`restaurantId`, `status`),
  INDEX `withdrawalrequest_status_createdAt_idx` (`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `restaurantwallet`
  ADD CONSTRAINT `restaurantwallet_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `walletledger`
  ADD CONSTRAINT `walletledger_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `withdrawalrequest`
  ADD CONSTRAINT `withdrawalrequest_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
