-- Phase F.3: Recipe / BOM
-- Additive migration — no destructive changes
-- Restaurant-level composition of one product. No HPP/COGS until F.4+.

-- 1. New table: recipe (1 product = 1 recipe)
CREATE TABLE `recipe` (
  `id` VARCHAR(191) NOT NULL,
  `restaurantId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `recipe_productId_key` (`productId`),
  UNIQUE INDEX `recipe_restaurantId_productId_key` (`restaurantId`, `productId`),
  INDEX `recipe_restaurantId_idx` (`restaurantId`),
  CONSTRAINT `recipe_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `recipe_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 2. New table: recipeitem (ingredient composition rows)
-- RecipeItem -> Recipe : ON DELETE CASCADE (rows removed with recipe)
-- RecipeItem -> Ingredient : NO cascade (ingredient must never be deleted by recipe changes)
CREATE TABLE `recipeitem` (
  `id` VARCHAR(191) NOT NULL,
  `recipeId` VARCHAR(191) NOT NULL,
  `ingredientId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `unit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `recipeitem_recipeId_ingredientId_key` (`recipeId`, `ingredientId`),
  INDEX `recipeitem_recipeId_idx` (`recipeId`),
  INDEX `recipeitem_ingredientId_idx` (`ingredientId`),
  CONSTRAINT `recipeitem_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `recipeitem_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;