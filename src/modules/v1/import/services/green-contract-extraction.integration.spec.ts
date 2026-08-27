import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GreenContractExtractionService } from './green-contract-extraction.service';

// Jest does not read .env the way Nest's ConfigModule does, and this suite is
// specifically meant to run against the real configuration.
loadEnv();

/**
 * Spec §11 / §14 step 5 — a real, gated call against Haiku.
 *
 * Unlike the unit spec next door, this one does NOT mock the Anthropic client: it
 * sends an actual Green Contract PDF and checks the model returns something
 * structurally usable. That is the only way to catch a prompt that reads fine but
 * extracts badly, which no amount of mocked JSON will reveal.
 *
 * It is skipped unless BOTH are set, so CI without an API key stays green and
 * nobody is billed by accident:
 *
 *   RUN_GREEN_CONTRACT_INTEGRATION=true   ANTHROPIC_API_KEY=sk-...
 *
 * Run it with:
 *   RUN_GREEN_CONTRACT_INTEGRATION=true npx jest green-contract-extraction.integration
 */

const FIXTURE_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'tenancy contracts');

interface GreenFixture {
  file: string;
  expect: {
    buildingCode: string;
    unitNumber: string;
    tenantType: 'Individual' | 'Company';
    annualRent: number;
    contractNumber: string;
  };
}

const FIXTURES: GreenFixture[] = [
  {
    file: '101 - R6 - Green conrtact.pdf',
    expect: {
      buildingCode: 'R6',
      unitNumber: '101',
      tenantType: 'Individual',
      annualRent: 47250,
      contractNumber: 'GC-R6-101',
    },
  },
  // The §11 R19 sample (company, monthly, "Mezan" qualifier, CN trade licence) is
  // not in the fixture folder yet. Drop the PDF in and this entry starts running.
  // {
  //   file: '07 - Mezan - R19 - Green contract.pdf',
  //   expect: { buildingCode: 'R19', unitNumber: '07', tenantType: 'Company',
  //             annualRent: 27000, contractNumber: 'GC-R19-07' },
  // },
];

const enabled =
  process.env.RUN_GREEN_CONTRACT_INTEGRATION === 'true' && Boolean(process.env.ANTHROPIC_API_KEY);

const available = FIXTURES.filter((f) => existsSync(join(FIXTURE_DIR, f.file)));

// eslint-disable-next-line jest/no-disabled-tests
const describeIntegration = enabled && available.length > 0 ? describe : describe.skip;

describeIntegration('GreenContractExtractionService (live Haiku)', () => {
  let service: GreenContractExtractionService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GreenContractExtractionService,
        {
          provide: ConfigService,
          useValue: {
            // Read straight from the environment — the point is to exercise the
            // real configuration, not a stand-in for it.
            get: (key: string, fallback?: unknown) => process.env[key] ?? fallback,
          },
        },
      ],
    }).compile();

    service = module.get(GreenContractExtractionService);
  });

  it.each(available.map((f) => [f.file, f] as const))(
    'extracts %s into a usable candidate',
    async (_name, fixture) => {
      const buffer = readFileSync(join(FIXTURE_DIR, fixture.file));
      const result = await service.extract(buffer, fixture.file);

      // Cost visibility is half the reason this test exists (§5.6, §12).
      const { inputTokens, outputTokens } = result.usage;
      // Haiku 4.5 list price, USD per million tokens.
      const costUsd = (inputTokens / 1e6) * 1.0 + (outputTokens / 1e6) * 5.0;
      console.log(
        `[green-contract] ${fixture.file}: in=${inputTokens} out=${outputTokens} ` +
          `≈ $${costUsd.toFixed(5)} per contract`,
      );
      console.log(`[green-contract] extracted: ${JSON.stringify(result.rawExtraction, null, 2)}`);

      expect(result.building.code).toBe(fixture.expect.buildingCode);
      expect(result.unit.unitNumber).toBe(fixture.expect.unitNumber);
      expect(result.contract.contractNumber).toBe(fixture.expect.contractNumber);
      expect(result.tenant.tenantType).toBe(fixture.expect.tenantType);
      expect(result.contract.annualRent).toBe(fixture.expect.annualRent);

      // Structural sanity — these must hold for any Green Contract, whatever the model returned.
      expect(result.contract.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.contract.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(result.contract.endDate) > new Date(result.contract.startDate)).toBe(true);
      expect(result.tenant.nameEn.length).toBeGreaterThan(1);
      expect(result.contract.monthlyRent).toBeGreaterThan(0);
    },
    // A live PDF round-trip is far slower than jest's 5s default.
    120_000,
  );

  it('is deterministic — the same PDF extracts identically twice', async () => {
    // temperature 0 is what makes a re-import safe; if this ever fails, a
    // re-uploaded contract could silently produce different rows.
    const fixture = available[0];
    const buffer = readFileSync(join(FIXTURE_DIR, fixture.file));

    const [first, second] = await Promise.all([
      service.extract(buffer, fixture.file),
      service.extract(buffer, fixture.file),
    ]);

    expect(second.rawExtraction).toEqual(first.rawExtraction);
  }, 120_000);
});

// Visible reason for the skip, rather than a silently absent suite.
if (!enabled) {
  describe('GreenContractExtractionService (live Haiku)', () => {
    it.skip('skipped — set RUN_GREEN_CONTRACT_INTEGRATION=true and ANTHROPIC_API_KEY to run', () => {
      /* intentionally empty */
    });
  });
} else if (available.length === 0) {
  describe('GreenContractExtractionService (live Haiku)', () => {
    it.skip(`skipped — no Green Contract fixtures found in ${FIXTURE_DIR}`, () => {
      /* intentionally empty */
    });
  });
}
