-- Reverts 20260821122628_add_property_unit_sort_keys.
--
-- Those generated columns were added to support grouping the contracts list by
-- building and ordering units naturally. unit_sort_number is a BIGINT, and
-- PropertiesService returns raw Prisma rows with no `select`, so the value
-- reached the JSON response — where JSON.stringify throws on BigInt instead of
-- coercing it. Every properties endpoint returned 500 with
-- "Do not know how to serialize a BigInt".
--
-- Rolled forward rather than by deleting the original migration, so environments
-- that already applied it converge cleanly instead of erroring on a migration
-- recorded in _prisma_migrations but missing from disk.
--
-- Dropping the columns loses nothing: both were GENERATED ALWAYS from
-- unit_number, so re-adding them recomputes every value from the source column.
--
-- If the sorting work is picked up again, keep the columns out of the API
-- response (a toResponse() strip in PropertiesService) or make the sort key an
-- INTEGER rather than BIGINT.

-- DropIndex
DROP INDEX IF EXISTS "properties_building_id_unit_sort_prefix_unit_sort_number_idx";

-- AlterTable
ALTER TABLE "properties"
  DROP COLUMN IF EXISTS "unit_sort_prefix",
  DROP COLUMN IF EXISTS "unit_sort_number";
