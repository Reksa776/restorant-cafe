-- Production hardening migration:
-- 1. User.sessionVersion — JWT revocation on password change / deactivation (M3)
-- 2. PaymentStatus.CANCELLED — supported by iPaymu webhook mapping (M1)
-- 3. Order.customerId index — bounded customer stats query (LOW-8)

-- User session version (default 0 = existing rows keep working after deploy;
-- old JWTs without the claim are rejected once, forcing a clean re-login).
ALTER TABLE `user` ADD COLUMN `sessionVersion` INT NOT NULL DEFAULT 0;

-- Extend payment status enums with CANCELLED (order of existing values kept).
ALTER TABLE `payment`
    MODIFY `status` ENUM('UNPAID', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'UNPAID';

ALTER TABLE `order`
    MODIFY `paymentStatus` ENUM('UNPAID', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'UNPAID';

-- Customer statistics lookups (customer.service getCustomers).
CREATE INDEX `order_customerId_idx` ON `order`(`customerId`);