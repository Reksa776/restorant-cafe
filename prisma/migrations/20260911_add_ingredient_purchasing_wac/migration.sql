-- Phase F.2: Ingredient Purchasing + WAC
-- Additive migration — no destructive changes

-- 1. New table: purchaseingredient
CREATE TABLE `purchaseingredient` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseId` VARCHAR(191) NOT NULL,
  `ingredientId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `unit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL DEFAULT 'PCS',
  `unitCost` DECIMAL(12,2) NOT NULL,
  `lineTotal` DECIMAL(12,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `purchaseingredient_purchaseId_idx` (`purchaseId`),
  INDEX `purchaseingredient_ingredientId_idx` (`ingredientId`),
  CONSTRAINT `purchaseingredient_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `purchaseingredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 2. Add cost fields to BranchIngredient
ALTER TABLE `branchingredient`
  ADD COLUMN `averageCost` DECIMAL(12,2) NULL,
  ADD COLUMN `lastPurchaseCost` DECIMAL(12,2) NULL;
