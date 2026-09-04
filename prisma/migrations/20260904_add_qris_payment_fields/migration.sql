-- Add QRIS QR data storage to the Payment table.
-- Both columns are nullable and additive: existing Payment rows are untouched
-- and remain fully backward compatible.
ALTER TABLE `payment` ADD COLUMN `qrImage` TEXT NULL,
                     ADD COLUMN `qrString` TEXT NULL;