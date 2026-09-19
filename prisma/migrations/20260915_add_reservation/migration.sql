-- Phase R1: Reservation (table booking foundation)
-- Additive migration — no destructive changes, no data loss.
--
-- Creates ONLY the new `reservation` table (plus its indexes). No existing
-- business table is altered: Order, Payment, Table, Customer and
-- RestaurantSettings are untouched, so nothing in the order / payment /
-- reporting / HPP-adjacent engines can change behaviour.
--
-- Time is stored timezone-free on purpose:
--   reservationDate — DATE (calendar day, no time component)
--   startMinutes    — minutes from local midnight (0..1439)
--   durationMinutes — booking length in minutes
-- Overlap/capacity decisions are therefore pure integer arithmetic.
--
-- `orderId` is a plain scalar (no foreign key): converting a reservation to
-- an order at check-in must not add a relation or migration to `order`.
-- Likewise customerId/tableId are optional cross-references resolved and
-- validated server-side, never trusted from the client.

CREATE TABLE `reservation` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NULL,
  `tableId` VARCHAR(191) NULL,
  `guestName` VARCHAR(191) NOT NULL,
  `guestPhone` VARCHAR(191) NOT NULL,
  `partySize` INTEGER NOT NULL,
  `reservationDate` DATE NOT NULL,
  `startMinutes` INTEGER NOT NULL,
  `durationMinutes` INTEGER NOT NULL DEFAULT 90,
  `status` ENUM('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING',
  `notes` TEXT NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'PUBLIC',
  `orderId` VARCHAR(191) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `seatedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `reservation_restaurantId_code_key` (`restaurantId`, `code`),
  INDEX `reservation_restaurantId_branchId_reservationDate_status_idx` (`restaurantId`, `branchId`, `reservationDate`, `status`),
  INDEX `reservation_tableId_reservationDate_status_idx` (`tableId`, `reservationDate`, `status`),
  INDEX `reservation_customerId_idx` (`customerId`),
  INDEX `reservation_guestPhone_idx` (`guestPhone`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
