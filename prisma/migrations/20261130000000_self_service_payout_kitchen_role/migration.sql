-- Self-service merchant payouts + KITCHEN staff accounts.
--
-- 1. `user.role` gains KITCHEN (Dapur). Existing rows keep their role.
-- 2. `walletledger.type` gains WITHDRAWAL_DISBURSED: a self-service payout is
--    settled in the same transaction that debits availableBalance, so the
--    ledger records the transfer instead of a separate approval step.
--
-- Purely additive enum widening: no column, index or row is rewritten.

ALTER TABLE `user`
  MODIFY `role` ENUM('ADMIN', 'CASHIER', 'KITCHEN') NOT NULL DEFAULT 'ADMIN';

ALTER TABLE `walletledger`
  MODIFY `type` ENUM('ORDER_CREDIT', 'WITHDRAWAL_HOLD', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_DISBURSED', 'PLATFORM_FEE', 'ADJUSTMENT') NOT NULL;
