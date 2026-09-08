-- Additive migration: per-branch inventory quantity on BranchProduct.
-- Additive only: adds one NOT NULL column with a DEFAULT so existing rows
-- receive stock = 0 (safe for production, no data loss, no table rebuild).
-- No drop/delete of data; does not touch Product/Order/Payment behavior.
-- AlterTable
ALTER TABLE `branchproduct` ADD COLUMN `stock` INT NOT NULL DEFAULT 0;
