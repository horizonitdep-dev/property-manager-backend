import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GreenContractExtractionService } from './green-contract-extraction.service';
import { GreenContractExtractionError } from '../green-contract-extraction.error';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const mockAnthropic = jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  (mockAnthropic as unknown as { default: unknown }).default = mockAnthropic;
  return mockAnthropic;
});

function textResponse(json: unknown, usage = { input_tokens: 900, output_tokens: 180 }) {
  return {
    stop_reason: 'end_turn',
    usage,
    content: [{ type: 'text', text: JSON.stringify(json) }],
  };
}

/** The R6 sample: individual tenant, 4 installments, Emirates ID. */
const r6Extraction = {
  internalReference: null,
  building: { code: 'R6', nameQualifier: null },
  unit: { unitNumber: '101' },
  tenant: {
    type: 'INDIVIDUAL',
    nameEn: 'Srikrishnan Suyambu Suyambu',
    nameAr: null,
    phone: '+971567372527',
    emiratesIdNumber: '784-1990-3780179-4',
    tradeLicenseNumber: null,
    authorizedPersonNameEn: null,
    authorizedPersonNameAr: null,
  },
  contract: {
    startDate: '2026-07-08',
    endDate: '2027-07-07',
    annualRent: 47250,
    monthlyRent: null,
    paymentFrequencyRaw: '4 installments',
    installmentsCount: 4,
    observations: null,
    utilitiesNote: null,
  },
};

/** The R19 sample: company tenant, monthly, CN trade licence, "Mezan" qualifier. */
const r19Extraction = {
  internalReference: 'REF-2026-07',
  building: { code: 'R19', nameQualifier: 'Mezan' },
  unit: { unitNumber: '07' },
  tenant: {
    type: 'COMPANY',
    nameEn: 'Mezan Trading LLC',
    nameAr: 'ميزان للتجارة',
    phone: null,
    emiratesIdNumber: null,
    tradeLicenseNumber: 'CN:1027292-2',
    authorizedPersonNameEn: null,
    authorizedPersonNameAr: null,
  },
  contract: {
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    annualRent: 27000,
    monthlyRent: 2250,
    paymentFrequencyRaw: '2250 AED Monthly',
    installmentsCount: null,
    observations: 'Tenant to maintain the AC units',
    utilitiesNote: 'Rent Included Water and electricity',
  },
};

const PDF = Buffer.from('%PDF-1.6\n');

describe('GreenContractExtractionService', () => {
  let service: GreenContractExtractionService;

  beforeEach(async () => {
    mockCreate.mockReset();

    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const values: Record<string, unknown> = {
          ANTHROPIC_API_KEY: 'test-key',
          ANTHROPIC_MODEL_GREEN_CONTRACT: 'claude-haiku-4-5-20251001',
          ANTHROPIC_MAX_TOKENS_GREEN_CONTRACT: 1500,
          ANTHROPIC_TEMPERATURE_GREEN_CONTRACT: 0,
        };
        return key in values ? values[key] : fallback;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GreenContractExtractionService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(GreenContractExtractionService);
  });

  describe('R6 fixture — individual, 4 installments', () => {
    beforeEach(() => mockCreate.mockResolvedValue(textResponse(r6Extraction)));

    it('derives the contract number as GC-{code}-{unit}', async () => {
      const result = await service.extract(PDF, '101 - R6 - Green contract.pdf');

      expect(result.contract.contractNumber).toBe('GC-R6-101');
      expect(
        result.contract.flags.some((f) => f.field === 'contractNumber' && f.status === 'derived'),
      ).toBe(true);
    });

    it('maps "4 installments" to Cheques with the count', async () => {
      const result = await service.extract(PDF, 'r6.pdf');

      expect(result.contract.paymentFrequency).toBe('Cheques');
      expect(result.contract.numberOfCheques).toBe(4);
    });

    it('keeps the tenant identity and types them INDIVIDUAL', async () => {
      const result = await service.extract(PDF, 'r6.pdf');

      expect(result.tenant.tenantType).toBe('Individual');
      expect(result.tenant.nameEn).toBe('Srikrishnan Suyambu Suyambu');
      expect(result.tenant.emiratesIdNumber).toBe('784-1990-3780179-4');
      expect(result.tenant.tradeLicenseNumber).toBeUndefined();
    });

    it('carries the dates and rent through unchanged', async () => {
      const result = await service.extract(PDF, 'r6.pdf');

      expect(result.contract.startDate).toBe('2026-07-08');
      expect(result.contract.endDate).toBe('2027-07-07');
      expect(result.contract.annualRent).toBe(47250);
    });

    it('derives a monthly rent when the contract states only an annual one', async () => {
      const result = await service.extract(PDF, 'r6.pdf');

      expect(result.contract.monthlyRent).toBe(3938); // round(47250 / 12)
      expect(
        result.contract.flags.some((f) => f.field === 'monthlyRent' && f.status === 'derived'),
      ).toBe(true);
    });

    it('uses the code as the building name when no qualifier is present', async () => {
      const result = await service.extract(PDF, 'r6.pdf');

      expect(result.building.code).toBe('R6');
      expect(result.building.name).toBe('R6');
      expect(result.building.flags.some((f) => f.field === 'name' && f.status === 'derived')).toBe(true);
    });
  });

  describe('R19 fixture — company, monthly, name qualifier', () => {
    beforeEach(() => mockCreate.mockResolvedValue(textResponse(r19Extraction)));

    it('derives GC-R19-07 and types the tenant COMPANY', async () => {
      const result = await service.extract(PDF, 'r19.pdf');

      expect(result.contract.contractNumber).toBe('GC-R19-07');
      expect(result.tenant.tenantType).toBe('Company');
      expect(result.tenant.tradeLicenseNumber).toBe('CN:1027292-2');
      expect(result.tenant.emiratesIdNumber).toBeUndefined();
    });

    it('takes the building name from the qualifier', async () => {
      const result = await service.extract(PDF, 'r19.pdf');

      expect(result.building.name).toBe('Mezan');
      expect(result.building.flags.some((f) => f.field === 'name' && f.status === 'ok')).toBe(true);
    });

    it('maps a monthly phrase to Monthly and keeps the stated monthly rent', async () => {
      const result = await service.extract(PDF, 'r19.pdf');

      expect(result.contract.paymentFrequency).toBe('Monthly');
      expect(result.contract.monthlyRent).toBe(2250);
      expect(result.contract.numberOfCheques).toBeUndefined();
    });

    it('folds observations, utilities and the landlord reference into notes', async () => {
      const result = await service.extract(PDF, 'r19.pdf');

      expect(result.contract.notes).toContain('Tenant to maintain the AC units');
      expect(result.contract.notes).toContain('Rent Included Water and electricity');
      expect(result.contract.notes).toContain('REF-2026-07');
    });

    it('flags the company profile as incomplete without blocking the row', async () => {
      const result = await service.extract(PDF, 'r19.pdf');

      expect(
        result.tenant.flags.some((f) => f.field === 'companyProfile' && f.status === 'missing'),
      ).toBe(true);
    });
  });

  describe('Arabic handling', () => {
    it('preserves Arabic verbatim rather than transliterating', async () => {
      mockCreate.mockResolvedValue(textResponse(r19Extraction));

      const result = await service.extract(PDF, 'r19.pdf');

      expect(result.tenant.nameAr).toBe('ميزان للتجارة');
    });
  });

  describe('payment frequency mapping', () => {
    async function frequencyOf(raw: string, installmentsCount: number | null = null) {
      mockCreate.mockResolvedValue(
        textResponse({
          ...r6Extraction,
          contract: { ...r6Extraction.contract, paymentFrequencyRaw: raw, installmentsCount },
        }),
      );
      const result = await service.extract(PDF, 'x.pdf');
      return result.contract;
    }

    it.each([
      ['Quarterly', 'Quarterly'],
      ['Bi-annual', 'Bi-Annual'],
      ['Semi annual', 'Bi-Annual'],
      ['Yearly', 'Annual'],
      ['Single payment', 'Single Payment'],
      ['Lump sum', 'Single Payment'],
    ])('maps %s to %s', async (raw, expected) => {
      expect((await frequencyOf(raw)).paymentFrequency).toBe(expected);
    });

    it('prefers the installment count over the digits in the phrase', async () => {
      const contract = await frequencyOf('4 installments', 6);

      expect(contract.numberOfCheques).toBe(6);
    });

    it('reads the count from the phrase when the model omits it', async () => {
      const contract = await frequencyOf('12 installments', null);

      expect(contract.numberOfCheques).toBe(12);
    });

    it('checks installments before the yearly wording in a mixed phrase', async () => {
      // "4 installments yearly" carries both signals; the count is the specific one.
      const contract = await frequencyOf('4 installments yearly', 4);

      expect(contract.paymentFrequency).toBe('Cheques');
      expect(contract.numberOfCheques).toBe(4);
    });

    it('defaults to Monthly and flags it when the phrase is unrecognised', async () => {
      const contract = await frequencyOf('as agreed between the parties');

      expect(contract.paymentFrequency).toBe('Monthly');
      expect(
        contract.flags.some((f) => f.field === 'paymentFrequency' && f.status === 'guessed'),
      ).toBe(true);
    });
  });

  describe('failure handling', () => {
    it('turns malformed JSON into a row error, not a crash', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'text', text: 'not json{' }],
      });

      await expect(service.extract(PDF, 'bad.pdf')).rejects.toThrow(GreenContractExtractionError);
      await expect(service.extract(PDF, 'bad.pdf')).rejects.toThrow(/malformed JSON/);
    });

    it('tolerates a markdown-fenced reply', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(r6Extraction) + '\n```' }],
      });

      await expect(service.extract(PDF, 'fenced.pdf')).resolves.toMatchObject({
        contract: { contractNumber: 'GC-R6-101' },
      });
    });

    it('rejects a tenant with neither a CN nor an Emirates ID nor a name', async () => {
      mockCreate.mockResolvedValue(
        textResponse({
          ...r6Extraction,
          tenant: { ...r6Extraction.tenant, nameEn: null, emiratesIdNumber: null, tradeLicenseNumber: null },
        }),
      );

      await expect(service.extract(PDF, 'anon.pdf')).rejects.toThrow(/Cannot determine tenant type/);
    });

    it('rejects a missing building code', async () => {
      mockCreate.mockResolvedValue(
        textResponse({ ...r6Extraction, building: { code: '   ', nameQualifier: null } }),
      );

      await expect(service.extract(PDF, 'nobuilding.pdf')).rejects.toThrow(/building code/);
    });

    it('fails schema validation when a required field is absent', async () => {
      mockCreate.mockResolvedValue(
        textResponse({
          ...r6Extraction,
          contract: { ...r6Extraction.contract, startDate: undefined },
        }),
      );

      await expect(service.extract(PDF, 'partial.pdf')).rejects.toThrow(/schema validation/);
    });

    it('surfaces a model refusal clearly', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'refusal',
        usage: { input_tokens: 10, output_tokens: 0 },
        content: [],
      });

      await expect(service.extract(PDF, 'refused.pdf')).rejects.toThrow(/declined to process/);
    });

    it('names the file in the error so a batch can report which PDF failed', async () => {
      mockCreate.mockRejectedValue(new Error('502 upstream'));

      await expect(service.extract(PDF, '101 - R6.pdf')).rejects.toThrow(/101 - R6\.pdf/);
    });
  });

  describe('model configuration', () => {
    it('calls Haiku with the configured budget and temperature 0', async () => {
      mockCreate.mockResolvedValue(textResponse(r6Extraction));

      await service.extract(PDF, 'r6.pdf');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          temperature: 0,
        }),
      );
    });

    it('reports token usage so cost per contract is visible', async () => {
      mockCreate.mockResolvedValue(textResponse(r6Extraction, { input_tokens: 1234, output_tokens: 210 }));

      const result = await service.extract(PDF, 'r6.pdf');

      expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 210 });
    });

    it('keeps the raw model output for auditing', async () => {
      mockCreate.mockResolvedValue(textResponse(r6Extraction));

      const result = await service.extract(PDF, 'r6.pdf');

      expect(result.rawExtraction).toMatchObject({ building: { code: 'R6' } });
    });
  });
});
