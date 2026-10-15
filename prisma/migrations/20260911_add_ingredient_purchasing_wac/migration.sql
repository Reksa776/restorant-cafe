-- Phase F.2: Ingredient Purchasing + WAC
-- Additive migration — no destructive changes

-- 1. Add cost fields to BranchIngredient
--    NOTE (F-7 repair): `purchaseingredient` used to be created here, before its
--    parent table `purchase` existed (created later by
--    20260911140000_add_purchasing_inventory_foundation), which made an empty-DB
--    replay fail with errno 1146. Its CREATE TABLE was relocated verbatim to that
--    migration; the SQL below is unchanged.
ALTER TABLE `branchingredient`
  ADD COLUMN `averageCost` DECIMAL(12,2) NULL,
  ADD COLUMN `lastPurchaseCost` DECIMAL(12,2) NULL;
