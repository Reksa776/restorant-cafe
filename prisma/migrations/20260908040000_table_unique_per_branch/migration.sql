-- Multi-branch (Phase M3): table number is unique per branch, not per
-- restaurant. After the branch backfill no dupplicates exist, so the global
-- (restaurantId, number) constraint is safely replaced.
ALTER TABLE `table` DROP INDEX `table_restaurantId_number_key`;
ALTER TABLE `table` ADD UNIQUE INDEX `table_restaurantId_branchId_number_key`(`restaurantId`, `branchId`, `number`);
