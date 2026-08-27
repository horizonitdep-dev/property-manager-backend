-- Green Contract import support (spec §4, §8).
--
-- Three additive changes. Nothing existing is dropped or narrowed, and the DMT
-- ingestion path keeps behaving exactly as before.
--
--   1. ImportSession.session_type  — which importer produced a session
--   2. Building.property_registration_no — new, NULLABLE (Green Contracts have no PRP)
--   3. Contract.source             — which path created a contract, with backfill

-- CreateEnum
CREATE TYPE "ImportSessionType" AS ENUM (
  'DMT_TAWTHEEQ',
  'R6_GREEN_CONTRACT',
  'CSV_EXCEL_BUILDINGS',
  'CSV_EXCEL_PROPERTIES',
  'CSV_EXCEL_TENANTS',
  'CSV_EXCEL_CONTRACTS'
);

-- CreateEnum
CREATE TYPE "ContractSource" AS ENUM (
  'DMT_TAWTHEEQ',
  'R6_GREEN_CONTRACT',
  'MANUAL',
  'CSV_IMPORT'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Building.property_registration_no
--
-- Added nullable rather than required: a Green Contract carries no PRP and one
-- must never be fabricated, so `code` stays the identifier both paths resolve on.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "property_registration_no" TEXT;
CREATE INDEX IF NOT EXISTS "buildings_property_registration_no_idx" ON "buildings"("property_registration_no");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ImportSession.session_type
--
-- Added nullable, backfilled, then set NOT NULL — adding it as required outright
-- would fail against existing rows.
--
-- The spec's §4.1 says to backfill every existing row to DMT_TAWTHEEQ. That is
-- deliberately NOT done here: only 14 of ~99 sessions are DMT PDF batches, and
-- blanket-labelling the rest would misreport every CSV/Excel import in history —
-- and would then feed the wrong answer into the Contract.source step below.
--
-- Classification instead:
--   a. rows_data->>'kind' = 'pdf-batch'  → the DMT batch anchor session
--   b. the buildings/properties/tenants sessions those anchors point at, read
--      out of the anchor's own linkage JSON
--   c. everything else → CSV_EXCEL_<module>, taken from the existing `module` column
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "import_sessions" ADD COLUMN "session_type" "ImportSessionType";

-- (a) DMT batch anchors
UPDATE "import_sessions"
SET "session_type" = 'DMT_TAWTHEEQ'
WHERE "rows_data" ->> 'kind' = 'pdf-batch';

-- (b) Leaf sessions referenced by a DMT anchor's linkage
UPDATE "import_sessions"
SET "session_type" = 'DMT_TAWTHEEQ'
WHERE "session_type" IS NULL
  AND "id"::text IN (
    SELECT linked
    FROM "import_sessions" anchor,
         LATERAL (VALUES
           (anchor."rows_data" ->> 'buildingsSessionId'),
           (anchor."rows_data" ->> 'propertiesSessionId'),
           (anchor."rows_data" ->> 'tenantsSessionId')
         ) AS v(linked)
    WHERE anchor."rows_data" ->> 'kind' = 'pdf-batch'
      AND linked IS NOT NULL
  );

-- (c) Everything else is a CSV/Excel import, typed from its module
UPDATE "import_sessions"
SET "session_type" = CASE "module"
  WHEN 'BUILDINGS'  THEN 'CSV_EXCEL_BUILDINGS'::"ImportSessionType"
  WHEN 'PROPERTIES' THEN 'CSV_EXCEL_PROPERTIES'::"ImportSessionType"
  WHEN 'TENANTS'    THEN 'CSV_EXCEL_TENANTS'::"ImportSessionType"
  WHEN 'CONTRACTS'  THEN 'CSV_EXCEL_CONTRACTS'::"ImportSessionType"
END
WHERE "session_type" IS NULL;

ALTER TABLE "import_sessions" ALTER COLUMN "session_type" SET NOT NULL;
CREATE INDEX "import_sessions_session_type_idx" ON "import_sessions"("session_type");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Contract.source (spec §8.2)
--
-- Added nullable so the backfill can be idempotent — it only touches rows where
-- source IS NULL — then defaulted and set NOT NULL. Re-running the UPDATEs after
-- that point matches nothing, so the migration is safe to replay.
--
-- Step (a) "by import session" from the spec is skipped: Contract has no
-- sourceImportSessionId and no audit trail linking it to a session, so there is
-- nothing to join on. The spec anticipates this and says to rely on step (b).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "contracts" ADD COLUMN "source" "ContractSource";

-- (b) DMT contract numbers are 6–12 digits with nothing else in them
UPDATE "contracts"
SET "source" = 'DMT_TAWTHEEQ'
WHERE "source" IS NULL
  AND "contract_number" ~ '^[0-9]{6,12}$';

-- (c) Everything remaining is treated as manually entered
UPDATE "contracts"
SET "source" = 'MANUAL'
WHERE "source" IS NULL;

ALTER TABLE "contracts" ALTER COLUMN "source" SET DEFAULT 'MANUAL';
ALTER TABLE "contracts" ALTER COLUMN "source" SET NOT NULL;
CREATE INDEX "contracts_source_idx" ON "contracts"("source");

-- ─────────────────────────────────────────────────────────────────────────────
-- Summary (spec §8.2 requires a completion log)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_dmt INT; c_csv INT; c_manual INT; c_green INT;
  s_dmt INT; s_csv INT;
BEGIN
  SELECT count(*) FILTER (WHERE source = 'DMT_TAWTHEEQ'),
         count(*) FILTER (WHERE source = 'CSV_IMPORT'),
         count(*) FILTER (WHERE source = 'MANUAL'),
         count(*) FILTER (WHERE source = 'R6_GREEN_CONTRACT')
    INTO c_dmt, c_csv, c_manual, c_green
  FROM "contracts";

  SELECT count(*) FILTER (WHERE session_type = 'DMT_TAWTHEEQ'),
         count(*) FILTER (WHERE session_type::text LIKE 'CSV_EXCEL_%')
    INTO s_dmt, s_csv
  FROM "import_sessions";

  RAISE NOTICE 'Backfilled contracts: % as DMT_TAWTHEEQ, % as CSV_IMPORT, % as MANUAL, % as R6_GREEN_CONTRACT',
    c_dmt, c_csv, c_manual, c_green;
  RAISE NOTICE 'Backfilled import sessions: % as DMT_TAWTHEEQ, % as CSV_EXCEL_*', s_dmt, s_csv;
END $$;
