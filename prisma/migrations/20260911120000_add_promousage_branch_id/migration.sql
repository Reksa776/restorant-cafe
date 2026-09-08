-- AlterTable
ALTER TABLE `promousage` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `promousage_branchId_idx` ON `promousage`(`branchId`);

-- AddForeignKey
ALTER TABLE `promousage` ADD CONSTRAINT `promousage_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;