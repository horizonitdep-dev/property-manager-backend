-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'STUDIO', 'SHOP', 'OFFICE', 'ROOF_UNIT', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('OCCUPIED', 'VACANT', 'UNDER_MAINTENANCE', 'RESERVED');

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "unit_number" TEXT NOT NULL,
    "building_id" UUID NOT NULL,
    "floor" INTEGER NOT NULL,
    "unit_type" "UnitType" NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "size_sqm" DECIMAL(10,2),
    "monthly_rent" DECIMAL(12,2) NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'VACANT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "properties_building_id_idx" ON "properties"("building_id");

-- CreateIndex
CREATE INDEX "properties_unit_number_idx" ON "properties"("unit_number");

-- CreateIndex
CREATE INDEX "properties_status_idx" ON "properties"("status");

-- CreateIndex
CREATE INDEX "properties_deleted_at_idx" ON "properties"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "properties_building_id_unit_number_key" ON "properties"("building_id", "unit_number");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
