-- CreateEnum
CREATE TYPE "ImportModule" AS ENUM ('BUILDINGS', 'PROPERTIES', 'TENANTS', 'CONTRACTS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING_REVIEW', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "import_sessions" (
    "id" UUID NOT NULL,
    "module" "ImportModule" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "original_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL,
    "error_rows" INTEGER NOT NULL,
    "rows_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,

    CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_sessions_module_idx" ON "import_sessions"("module");

-- CreateIndex
CREATE INDEX "import_sessions_status_idx" ON "import_sessions"("status");

-- CreateIndex
CREATE INDEX "import_sessions_created_by_idx" ON "import_sessions"("created_by");

-- AddForeignKey
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
