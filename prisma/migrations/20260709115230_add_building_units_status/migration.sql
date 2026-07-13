-- CreateEnum
CREATE TYPE "ConstructionStatus" AS ENUM ('COMPLETE', 'UNDER_CONSTRUCTION');

-- AlterTable
ALTER TABLE "buildings" ADD COLUMN     "construction_status" "ConstructionStatus" NOT NULL DEFAULT 'COMPLETE',
ADD COLUMN     "total_units" INTEGER;
