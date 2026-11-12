-- Add an optional smoke-area classification to each table in the floor plan.
-- Existing layout rows remain unclassified until an admin assigns an area.
ALTER TABLE `tablelayoutitem`
  ADD COLUMN `areaType` ENUM('SMOKING', 'NON_SMOKING') NULL;
