import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PdfExtractionService } from './pdf-extraction.service';
import { GreenContractExtractionService } from './green-contract-extraction.service';

loadEnv();

/**
 * Spec §11 — DMT regression, and cross-source integrity.
 *
 * The Green Contract work touched three lines of pdf-import.service.ts
 * (sessionType, and the ContractSource argument) and nothing at all in
 * pdf-extraction.service.ts. This suite proves the DMT extraction path still
 * behaves against a real Tawtheeq PDF, and that running both extractors
 * concurrently does not let one corrupt the other.
 *
 * Gated like the Green integration suite — needs BOTH:
 *   RUN_GREEN_CONTRACT_INTEGRATION=true   ANTHROPIC_API_KEY=sk-...
 */

const FIXTURE_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'tenancy contracts');
const DMT_FIXTURE = '101 - R6 (2).Pdf';
const GREEN_FIXTURE = '101 - R6 - Green conrtact.pdf';

const enabled =
  process.env.RUN_GREEN_CONTRACT_INTEGRATION === 'true' && Boolean(process.env.ANTHROPIC_API_KEY);
const hasDmt = existsSync(join(FIXTURE_DIR, DMT_FIXTURE));
const hasGreen = existsSync(join(FIXTURE_DIR, GREEN_FIXTURE));

const describeIntegration = enabled && hasDmt ? describe : describe.skip;

function envConfig() {
  return {
    provide: ConfigService,
    useValue: { get: (key: string, fallback?: unknown) => process.env[key] ?? fallback },
  };
}

describeIntegration('DMT extraction regression (live)', () => {
  let dmt: PdfExtractionService;
  let green: GreenContractExtractionService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfExtractionService, GreenContractExtractionService, envConfig()],
    }).compile();

    dmt = module.get(PdfExtractionService);
    green = module.get(GreenContractExtractionService);
  });

  it(
    'still extracts a real DMT contract with its Tawtheeq-specific fields intact',
    async () => {
      const buffer = readFileSync(join(FIXTURE_DIR, DMT_FIXTURE));
      const result = await dmt.extractContract(buffer, DMT_FIXTURE);

      console.log(
        `[dmt-regression] ${DMT_FIXTURE}: in=${result.usage.inputTokens} out=${result.usage.outputTokens}`,
      );
      console.log(
        `[dmt-regression] contract=${result.contract.contractNumber} ` +
          `building=${result.building.code} (PRP ${result.building.propertyRegistrationNo}) ` +
          `units=${result.units.length} tenant=${result.tenant.tenantType}`,
      );

      // The DMT-only fields — these are exactly what a Green Contract lacks, so
      // their presence proves the DMT prompt and schema are still in force.
      expect(result.contract.contractNumber).toBeTruthy();
      expect(result.building.propertyRegistrationNo).toMatch(/^PRP/i);
      expect(result.building.code).toBeTruthy();
      expect(result.units.length).toBeGreaterThan(0);

      // Structural sanity, unchanged from before the Green work.
      expect(result.contract.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.contract.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.contract.annualRent).toBeGreaterThan(0);
      expect(result.contract.monthlyRent).toBeGreaterThan(0);
      expect(['Individual', 'Company']).toContain(result.tenant.tenantType);
    },
    180_000,
  );

  it(
    'uses its own model, independent of the Green Contract config',
    async () => {
      // §13: the two paths must be tunable separately. If someone points
      // ANTHROPIC_MODEL_GREEN_CONTRACT at something else, DMT must not follow.
      expect(process.env.ANTHROPIC_MODEL_GREEN_CONTRACT).not.toBe(process.env.ANTHROPIC_MODEL);
    },
    10_000,
  );

  (enabled && hasDmt && hasGreen ? it : it.skip)(
    'runs both extractors concurrently without cross-contamination',
    async () => {
      const dmtBuffer = readFileSync(join(FIXTURE_DIR, DMT_FIXTURE));
      const greenBuffer = readFileSync(join(FIXTURE_DIR, GREEN_FIXTURE));

      const [dmtResult, greenResult] = await Promise.all([
        dmt.extractContract(dmtBuffer, DMT_FIXTURE),
        green.extract(greenBuffer, GREEN_FIXTURE),
      ]);

      // Each keeps its own shape: DMT carries a PRP and a units array; Green
      // carries a derived GC- number and a single unit.
      expect(dmtResult.building.propertyRegistrationNo).toMatch(/^PRP/i);
      expect(greenResult.contract.contractNumber).toMatch(/^GC-/);
      expect(dmtResult.contract.contractNumber).not.toMatch(/^GC-/);

      // Same physical building, reached by two different documents.
      console.log(
        `[cross-source] DMT building=${dmtResult.building.code} / Green building=${greenResult.building.code}`,
      );
    },
    240_000,
  );
});

if (!enabled) {
  describe('DMT extraction regression (live)', () => {
    it.skip('skipped — set RUN_GREEN_CONTRACT_INTEGRATION=true and ANTHROPIC_API_KEY to run', () => {
      /* intentionally empty */
    });
  });
} else if (!hasDmt) {
  describe('DMT extraction regression (live)', () => {
    it.skip(`skipped — ${DMT_FIXTURE} not found in ${FIXTURE_DIR}`, () => {
      /* intentionally empty */
    });
  });
}
