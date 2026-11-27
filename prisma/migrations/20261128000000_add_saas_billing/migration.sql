-- Phase 4 — SaaS subscription plans, branch add-ons and billing invoices.
-- Purely additive: no existing table is altered. Tenants without a row are
-- treated as STARTER/TRIAL by the application (self-healing on first read).

CREATE TABLE `restaurantsubscription` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `planCode` ENUM('STARTER', 'BASIC', 'PRO', 'ENTERPRISE') NOT NULL DEFAULT 'STARTER',
  `billingCycle` ENUM('MONTHLY', 'YEARLY') NOT NULL DEFAULT 'MONTHLY',
  `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'TRIAL',
  `extraBranchesCount` INTEGER NOT NULL DEFAULT 0,
  `currentPeriodStart` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `currentPeriodEnd` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `restaurantsubscription_restaurantId_key` (`restaurantId`),
  INDEX `restaurantsubscription_status_idx` (`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `saasinvoice` (
  `id` VARCHAR(191) NOT NULL,
  `invoiceNumber` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `targetPlanCode` ENUM('STARTER', 'BASIC', 'PRO', 'ENTERPRISE') NOT NULL,
  `billingCycle` ENUM('MONTHLY', 'YEARLY') NOT NULL,
  `addonBranchesQty` INTEGER NOT NULL DEFAULT 0,
  `amount` INTEGER NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `paymentUrl` VARCHAR(191) NULL,
  `externalRef` VARCHAR(191) NULL,
  `paidAt` DATETIME(3) NULL,
  `rawResponse` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `saasinvoice_invoiceNumber_key` (`invoiceNumber`),
  INDEX `saasinvoice_restaurantId_status_idx` (`restaurantId`, `status`),
  INDEX `saasinvoice_status_idx` (`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `restaurantsubscription`
  ADD CONSTRAINT `restaurantsubscription_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `saasinvoice`
  ADD CONSTRAINT `saasinvoice_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
