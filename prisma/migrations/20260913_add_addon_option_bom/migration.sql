-- Phase H4.1: Addon / Option mini-BOM
-- Additive migration — no destructive changes, no data loss.
--
-- Mirrors the F.3 recipe/recipeitem pattern for ONE addon unit / ONE option
-- selection. Tenant scope is transitive via addon -> productaddon -> product
-- and option -> productoption -> productoptiongroup -> product; no
-- restaurantId/branchId columns are added by design.

-- 1. New table: addoningredient
CREATE TABLE `addoningredient` (
  `id` VARCHAR(191) NOT NULL,
  `addonId` VARCHAR(191) NOT NULL,
  `ingredientId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18, 3) NOT NULL,
  `unit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `addoningredient_addonId_ingredientId_key` (`addonId`, `ingredientId`),
  INDEX `addoningredient_addonId_idx` (`addonId`),
  INDEX `addoningredient_ingredientId_idx` (`ingredientId`),
  CONSTRAINT `addoningredient_addonId_fkey` FOREIGN KEY (`addonId`) REFERENCES `productaddon`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `addoningredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. New table: optioningredient
CREATE TABLE `optioningredient` (
  `id` VARCHAR(191) NOT NULL,
  `optionId` VARCHAR(191) NOT NULL,
  `ingredientId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18, 3) NOT NULL,
  `unit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `optioningredient_optionId_ingredientId_key` (`optionId`, `ingredientId`),
  INDEX `optioningredient_optionId_idx` (`optionId`),
  INDEX `optioningredient_ingredientId_idx` (`ingredientId`),
  CONSTRAINT `optioningredient_optionId_fkey` FOREIGN KEY (`optionId`) REFERENCES `productoption`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `optioningredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
