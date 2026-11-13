CREATE TABLE `tablelayoutzone` (
  `id` VARCHAR(191) NOT NULL,
  `layoutId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `type` VARCHAR(24) NOT NULL,
  `x` DOUBLE NOT NULL,
  `y` DOUBLE NOT NULL,
  `width` DOUBLE NOT NULL,
  `height` DOUBLE NOT NULL,
  INDEX `tablelayoutzone_layoutId_idx`(`layoutId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `tablelayoutzone_layoutId_fkey` FOREIGN KEY (`layoutId`) REFERENCES `tablelayout`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
