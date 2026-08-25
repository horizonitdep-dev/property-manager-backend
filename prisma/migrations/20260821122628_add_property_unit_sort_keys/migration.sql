-- Derived sort keys for unit_number, so listings order the way people read them:
-- "Unit 9" before "Unit 10", and bare numbers before named units.
--
-- Sorting on unit_number as plain text gets both wrong — '10' < '9' and
-- 'Show Room 10' < 'Show Room 4' — which is what made the contracts list look
-- scattered. Splitting the trailing number out fixes the ordering while keeping
-- it a database-level ORDER BY, so pagination still works across pages.
--
-- GENERATED ALWAYS ... STORED means Postgres maintains these on every insert and
-- update. Nothing in the application writes them, and Postgres rejects any
-- attempt to. Both expressions are IMMUTABLE, as generated columns require.
--
--   '101'         -> prefix ''           number 101
--   'Show Room 4' -> prefix 'SHOW ROOM'  number 4
--   'CE2E-101'    -> prefix 'CE2E-'      number 101
--   'Office'      -> prefix 'OFFICE'     number NULL
--
-- Prisma cannot express generated columns, so these are declared as ordinary
-- optional columns in schema.prisma purely so ORDER BY can reference them.

-- AlterTable
ALTER TABLE "properties"
  ADD COLUMN "unit_sort_prefix" TEXT
    GENERATED ALWAYS AS (
      upper(btrim(regexp_replace("unit_number", '\d+\s*$', '')))
    ) STORED,
  -- Capped at 18 digits so an absurd unit number can never overflow bigint and
  -- fail the INSERT; substring() yields NULL when there is no trailing number.
  ADD COLUMN "unit_sort_number" BIGINT
    GENERATED ALWAYS AS (
      NULLIF(substring("unit_number" from '(\d{1,18})\s*$'), '')::bigint
    ) STORED;

-- CreateIndex
CREATE INDEX "properties_building_id_unit_sort_prefix_unit_sort_number_idx" ON "properties"("building_id", "unit_sort_prefix", "unit_sort_number");
