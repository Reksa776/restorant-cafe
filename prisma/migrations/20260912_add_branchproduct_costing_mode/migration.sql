-- Phase G.1 — per-branch HPP method + manual HPP.
-- ADDITIVE ONLY: new columns on an existing table, no data loss.
-- Existing rows default to INGREDIENT (the untouched F.4 automatic costing).
ALTER TABLE `branchproduct`
    ADD COLUMN `costingMode` ENUM('INGREDIENT', 'MANUAL') NOT NULL DEFAULT 'INGREDIENT',
    ADD COLUMN `manualHpp` DECIMAL(12, 2) NULL;
