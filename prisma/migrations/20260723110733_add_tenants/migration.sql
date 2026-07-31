-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'FORMER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('EMIRATES_ID', 'PASSPORT', 'TRADE_LICENSE', 'POWER_OF_ATTORNEY', 'OTHER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "tenant_type" "TenantType" NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "phone" TEXT NOT NULL,
    "alternate_phone" TEXT,
    "email" TEXT,
    "nationality" TEXT,
    "emirates_id_number" TEXT,
    "emirates_id_expiry" DATE,
    "passport_number" TEXT,
    "passport_expiry" DATE,
    "trade_license_number" TEXT,
    "trade_license_expiry" DATE,
    "authorized_person_name_en" TEXT,
    "authorized_person_name_ar" TEXT,
    "authorized_person_occupation" TEXT,
    "authorized_person_phone" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenants_name_en_idx" ON "tenants"("name_en");

-- CreateIndex
CREATE INDEX "tenants_name_ar_idx" ON "tenants"("name_ar");

-- CreateIndex
CREATE INDEX "tenants_tenant_type_idx" ON "tenants"("tenant_type");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_deleted_at_idx" ON "tenants"("deleted_at");

-- CreateIndex
CREATE INDEX "tenant_documents_tenant_id_idx" ON "tenant_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_documents_document_type_idx" ON "tenant_documents"("document_type");

-- CreateIndex
CREATE INDEX "tenant_documents_deleted_at_idx" ON "tenant_documents"("deleted_at");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
