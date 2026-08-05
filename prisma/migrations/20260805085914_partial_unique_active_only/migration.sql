-- DropIndex
DROP INDEX "buildings_code_key";

-- DropIndex
DROP INDEX "properties_building_id_unit_number_key";

-- CreateIndex
CREATE INDEX "properties_building_id_unit_number_idx" ON "properties"("building_id", "unit_number");

-- Partial unique indexes: uniqueness only applies among non-deleted rows, so a
-- soft-deleted building's code (or a soft-deleted property's unit number) can
-- be reused. A plain unique index can't express "except deleted rows" — this
-- is not representable via Prisma's @unique/@@unique, hence the raw SQL.
CREATE UNIQUE INDEX "buildings_code_active_key" ON "buildings"("code") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "properties_building_id_unit_number_active_key" ON "properties"("building_id", "unit_number") WHERE "deleted_at" IS NULL;
