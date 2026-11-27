-- ============================================================
-- Phase 2 — True SaaS multi-tenant: public tenant slug.
--
-- Safe on existing data: the column is added nullable, every existing
-- restaurant is backfilled with a deterministic slug (name + id suffix, which
-- is unique by construction because `id` is unique), and only then is the
-- NOT NULL + UNIQUE contract applied.
-- ============================================================

ALTER TABLE `restaurant` ADD COLUMN `slug` VARCHAR(191) NULL;

UPDATE `restaurant`
SET `slug` = CONCAT(
  COALESCE(
    NULLIF(
      TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(`name`, '[^a-zA-Z0-9]+', '-'))),
      ''
    ),
    'resto'
  ),
  '-',
  SUBSTRING(`id`, 1, 8)
)
WHERE `slug` IS NULL;

ALTER TABLE `restaurant` MODIFY `slug` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `restaurant_slug_key` ON `restaurant`(`slug`);

CREATE INDEX `restaurant_isActive_idx` ON `restaurant`(`isActive`);
