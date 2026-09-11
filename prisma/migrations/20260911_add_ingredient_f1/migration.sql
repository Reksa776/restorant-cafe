-- Phase F.1: Ingredient + Unit + Branch Stock
-- Additive migration — no destructive changes
--
-- `IngredientUnit` (PCS/GRAM/KG/ML/LITER) is an inline MySQL ENUM column —
-- Prisma enums are NOT separate tables in MySQL, so this migration emits no
-- DDL for the enum itself (only the ENUM(...) column below).

-- 1. New table: ingredient
CREATE TABLE `ingredient` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `baseUnit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL DEFAULT 'PCS',
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ingredient_restaurantId_name_key` (`restaurantId`, `name`),
  INDEX `ingredient_restaurantId_idx` (`restaurantId`),
  INDEX `ingredient_restaurantId_isActive_idx` (`restaurantId`, `isActive`),
  CONSTRAINT `ingredient_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 2. New table: branchingredient
CREATE TABLE `branchingredient` (
  `id` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NOT NULL,
  `ingredientId` VARCHAR(191) NOT NULL,
  `stock` DECIMAL(18,3) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `branchingredient_branchId_ingredientId_key` (`branchId`, `ingredientId`),
  INDEX `branchingredient_branchId_idx` (`branchId`),
  INDEX `branchingredient_ingredientId_idx` (`ingredientId`),
  CONSTRAINT `branchingredient_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `branchingredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 3. New table: ingredientstockmovement
CREATE TABLE `ingredientstockmovement` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NOT NULL,
  `ingredientId` VARCHAR(191) NOT NULL,
  `type` ENUM('IN','OUT','ADJUSTMENT') NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `balanceAfter` DECIMAL(18,3) NOT NULL,
  `refType` VARCHAR(191) NULL,
  `refId` VARCHAR(191) NULL,
  `reason` TEXT NULL,
  `userId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `ingredientstockmovement_restaurantId_branchId_createdAt_idx` (`restaurantId`, `branchId`, `createdAt`),
  INDEX `ingredientstockmovement_restaurantId_ingredientId_createdAt_idx` (`restaurantId`, `ingredientId`, `createdAt`),
  INDEX `ingredientstockmovement_restaurantId_type_createdAt_idx` (`restaurantId`, `type`, `createdAt`),
  INDEX `ingredientstockmovement_refType_refId_idx` (`refType`, `refId`),
  CONSTRAINT `ingredientstockmovement_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ingredientstockmovement_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ingredientstockmovement_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ingredientstockmovement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
