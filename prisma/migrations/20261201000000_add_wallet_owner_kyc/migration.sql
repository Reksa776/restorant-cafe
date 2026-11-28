-- Owner KYC (Data Diri Pemilik) + wallet relation sync.
--
-- 1. `restaurantwallet` gains the owner identity fields required before a
--    payout: full name, NIK (KTP), WhatsApp number, domicile address and the
--    timestamp of the last complete profile save.
-- 2. `walletledger.restaurantWalletId` and `withdrawalrequest.restaurantWalletId`
--    already exist in the Prisma schema but were never emitted by
--    `20261129000000_add_merchant_wallet`; this migration adds the columns,
--    their index and the FK so the schema and MySQL stay 100% in sync.
-- 3. `withdrawalrequest` gains the owner KYC snapshot (name/NIK/phone) so every
--    payout proof records who the owner was at withdrawal time.
--
-- Purely additive: no existing column/value is altered, and the new columns are
-- nullable so existing wallets and withdrawals keep working untouched.

ALTER TABLE `restaurantwallet`
  ADD COLUMN `ownerFullName` VARCHAR(191) NULL,
  ADD COLUMN `ownerNik` VARCHAR(191) NULL,
  ADD COLUMN `ownerPhone` VARCHAR(191) NULL,
  ADD COLUMN `ownerAddress` VARCHAR(255) NULL,
  ADD COLUMN `kycUpdatedAt` DATETIME(3) NULL;

ALTER TABLE `walletledger`
  ADD COLUMN `restaurantWalletId` VARCHAR(191) NULL,
  ADD INDEX `walletledger_restaurantWalletId_idx` (`restaurantWalletId`),
  ADD CONSTRAINT `walletledger_restaurantWalletId_fkey`
    FOREIGN KEY (`restaurantWalletId`) REFERENCES `restaurantwallet` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `withdrawalrequest`
  ADD COLUMN `ownerFullName` VARCHAR(191) NULL,
  ADD COLUMN `ownerNik` VARCHAR(191) NULL,
  ADD COLUMN `ownerPhone` VARCHAR(191) NULL,
  ADD COLUMN `restaurantWalletId` VARCHAR(191) NULL,
  ADD INDEX `withdrawalrequest_restaurantWalletId_idx` (`restaurantWalletId`),
  ADD CONSTRAINT `withdrawalrequest_restaurantWalletId_fkey`
    FOREIGN KEY (`restaurantWalletId`) REFERENCES `restaurantwallet` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
