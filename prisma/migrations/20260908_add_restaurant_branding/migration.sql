-- Website branding / theme customization per restaurant.
-- Additive only: existing rows are untouched (all branding fields nullable,
-- the app falls back to Restaurant.name + default theme colors).

CREATE TABLE `restaurantsettings` (
    `id` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `siteName` VARCHAR(191) NULL,
    `logoUrl` VARCHAR(191) NULL,
    `primaryColor` VARCHAR(191) NULL,
    `secondaryColor` VARCHAR(191) NULL,
    `accentColor` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `restaurantsettings_restaurantId_key`(`restaurantId`),
    INDEX `restaurantsettings_restaurantId_idx`(`restaurantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `restaurantsettings`
    ADD CONSTRAINT `restaurantsettings_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurant`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;