-- Phase 3 — Instant courier delivery (GrabExpress via Biteship aggregator).
-- Purely additive: existing rows keep working (delivery disabled by default,
-- deliveryFee defaults to 0, all origin/address columns nullable).

-- Courier pickup origin per branch.
ALTER TABLE `branch`
  ADD COLUMN `latitude` DOUBLE NULL,
  ADD COLUMN `longitude` DOUBLE NULL,
  ADD COLUMN `postalCode` VARCHAR(191) NULL,
  ADD COLUMN `contactPhone` VARCHAR(191) NULL;

-- Per-tenant BYOK delivery configuration. deliveryApiKey is a secret and is
-- never returned in full by the API.
ALTER TABLE `restaurantsettings`
  ADD COLUMN `deliveryEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `deliveryProvider` VARCHAR(191) NOT NULL DEFAULT 'MOCK',
  ADD COLUMN `deliveryApiKey` TEXT NULL,
  ADD COLUMN `deliveryAutoDispatchOn` VARCHAR(191) NOT NULL DEFAULT 'PAID';

-- Delivery destination + server-recomputed fee on the order.
ALTER TABLE `order`
  ADD COLUMN `deliveryFee` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `deliveryAddress` TEXT NULL,
  ADD COLUMN `deliveryLatitude` DOUBLE NULL,
  ADD COLUMN `deliveryLongitude` DOUBLE NULL,
  ADD COLUMN `deliveryNotes` TEXT NULL;

-- One courier booking per delivery order (orderId is unique).
CREATE TABLE `ordershipment` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `courierCode` VARCHAR(191) NOT NULL,
  `serviceType` VARCHAR(191) NOT NULL,
  `externalShipmentId` VARCHAR(191) NULL,
  `waybillId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `fee` INTEGER NOT NULL DEFAULT 0,
  `driverName` VARCHAR(191) NULL,
  `driverPhone` VARCHAR(191) NULL,
  `driverPlate` VARCHAR(191) NULL,
  `trackingUrl` TEXT NULL,
  `rawResponse` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ordershipment_orderId_key` (`orderId`),
  INDEX `ordershipment_restaurantId_idx` (`restaurantId`),
  INDEX `ordershipment_restaurantId_status_idx` (`restaurantId`, `status`),
  INDEX `ordershipment_externalShipmentId_idx` (`externalShipmentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ordershipment`
  ADD CONSTRAINT `ordershipment_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `order` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ordershipment`
  ADD CONSTRAINT `ordershipment_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
