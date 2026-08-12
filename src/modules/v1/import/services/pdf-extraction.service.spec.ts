import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PdfExtractionService } from './pdf-extraction.service';
import { PdfExtractionError } from '../pdf-extraction.error';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  // The real package's CJS export is itself a callable constructor AND carries
  // a `.default` pointing to the same constructor (for ESM-default-import
  // interop) — replicate both shapes so `import Anthropic from '@anthropic-ai/sdk'`
  // resolves correctly regardless of how ts-jest compiles the import.
  const mockAnthropic = jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  (mockAnthropic as unknown as { default: unknown }).default = mockAnthropic;
  return mockAnthropic;
});

function textResponse(json: unknown, usage = { input_tokens: 1000, output_tokens: 200 }) {
  return {
    stop_reason: 'end_turn',
    usage,
    content: [{ type: 'text', text: JSON.stringify(json) }],
  };
}

const baseExtraction = {
  contract: {
    contractNumber: 'C-2026-001',
    issueDate: '2026-01-01',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    annualRent: 24000,
    contractValue: null,
    securityDeposit: 2000,
    paymentMethod: 'Cheque',
    numberOfPayments: 4,
    contractType: 'New',
    waterElectricityBill: null,
    occupants: null,
  },
  tenant: {
    companyNameEn: 'Al Noor Trading LLC',
    companyNameAr: 'شركة النور للتجارة',
    individualNameEn: null,
    individualNameAr: null,
    tradeLicenseNumber: 'CN-1234567',
    mobile: '+971501234567',
    email: 'info@alnoor.ae',
  },
  building: {
    propertyRegistrationNo: 'PRP1234567',
    zone: 'Zone 1',
    sector: 'Sector 2',
    plotNo: 'Plot 3',
    onwaniAddress: 'Hamdan Street, Abu Dhabi',
  },
  units: [{ unitNumber: 'Shop 1', unitType: 'SHOP', areaSqm: 40, premiseNo: null, unitRegNo: null }],
};

describe('PdfExtractionService', () => {
  let service: PdfExtractionService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    mockCreate.mockReset();
    configService = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'ANTHROPIC_API_KEY') return 'test-key';
        if (key === 'ANTHROPIC_MODEL') return fallback ?? 'claude-sonnet-5';
        return fallback;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfExtractionService, { provide: ConfigService, useValue: configService }],
    }).compile();

    service = module.get<PdfExtractionService>(PdfExtractionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('normalizes a single-unit cheque contract', async () => {
    mockCreate.mockResolvedValue(textResponse(baseExtraction));

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');

    expect(result.tenant.tenantType).toBe('Company');
    expect(result.tenant.nameEn).toBe('Al Noor Trading LLC');
    expect(result.tenant.nameAr).toBe('شركة النور للتجارة');
    expect(result.units).toHaveLength(1);
    expect(result.units[0].unitType).toBe('Shop');
    expect(result.contract.paymentFrequency).toBe('Cheques');
    expect(result.contract.numberOfCheques).toBe(4);
    expect(result.contract.monthlyRent).toBe(2000); // round(24000/12)
    expect(result.contract.flags.some((f) => f.field === 'monthlyRent' && f.status === 'derived')).toBe(true);
    expect(result.building.code).toBe('SECTOR-2-PLOT-3'); // derived from Sector + Plot No.
    expect(result.building.name).toBe('Building SECTOR-2-PLOT-3');
    expect(result.building.flags.some((f) => f.field === 'code' && f.status === 'ok')).toBe(true);
  });

  it('falls back to the property registration number for building code when Sector/Plot No. are missing', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        building: { ...baseExtraction.building, sector: null, plotNo: null },
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');
    expect(result.building.code).toBe('PRP1234567');
    expect(result.building.flags.some((f) => f.field === 'code' && f.status === 'guessed')).toBe(true);
  });

  it('maps STORE unit type to Warehouse', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        units: [{ ...baseExtraction.units[0], unitType: 'STORE' }],
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');
    expect(result.units[0].unitType).toBe('Warehouse');
  });

  it('maps WORKSHOP unit type to Warehouse', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        units: [{ ...baseExtraction.units[0], unitType: 'WORKSHOP' }],
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');
    expect(result.units[0].unitType).toBe('Warehouse');
  });

  it('maps "Cash" with a single payment to Single Payment', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        contract: { ...baseExtraction.contract, paymentMethod: 'Cash', numberOfPayments: 1 },
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');
    expect(result.contract.paymentFrequency).toBe('Single Payment');
    expect(result.contract.numberOfCheques).toBeUndefined();
  });

  it('maps "Cash And Cheque" to Cheques and notes the cash portion', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        contract: { ...baseExtraction.contract, paymentMethod: 'Cash And Cheque', numberOfPayments: 2 },
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');
    expect(result.contract.paymentFrequency).toBe('Cheques');
    expect(result.contract.notes).toContain('Cash And Cheque');
  });

  it('expands a multi-unit contract into multiple unit candidates and notes the others', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        units: [
          { unitNumber: 'Shop 1', unitType: 'SHOP', areaSqm: 40, premiseNo: null, unitRegNo: null },
          { unitNumber: 'Shop 2', unitType: 'SHOP', areaSqm: 35, premiseNo: null, unitRegNo: null },
        ],
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');
    expect(result.units).toHaveLength(2);
    expect(result.contract.notes).toContain('Shop 2');
  });

  it('flags missing company fields without failing extraction (profileIncomplete path)', async () => {
    mockCreate.mockResolvedValue(textResponse(baseExtraction));

    const result = await service.extractContract(Buffer.from('pdf'), 'contract.pdf');
    expect(
      result.tenant.flags.some((f) => f.field === 'companyProfile' && f.status === 'missing'),
    ).toBe(true);
  });

  it('extracts an individual tenant\'s Emirates ID (residential contracts print it)', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        tenant: {
          companyNameEn: null,
          companyNameAr: null,
          individualNameEn: 'Wali Ullah Yaqoob Khan',
          individualNameAr: 'ولي الله يعقوب خان',
          tradeLicenseNumber: null,
          emiratesIdNumber: '784-1990-1234567-1',
          passportNumber: 'P1234567',
          nationality: 'Pakistan',
          mobile: '+971501234567',
          email: null,
        },
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'residential.pdf');

    expect(result.tenant.tenantType).toBe('Individual');
    expect(result.tenant.emiratesIdNumber).toBe('784-1990-1234567-1');
    expect(result.tenant.passportNumber).toBe('P1234567');
    expect(result.tenant.nationality).toBe('Pakistan');
    expect(result.tenant.tradeLicenseNumber).toBeUndefined();
    expect(result.tenant.flags.some((f) => f.field === 'emiratesIdNumber' && f.status === 'ok')).toBe(true);
  });

  it('flags an individual tenant with no Emirates ID without failing extraction', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        tenant: {
          companyNameEn: null,
          companyNameAr: null,
          individualNameEn: 'Wali Ullah Yaqoob Khan',
          individualNameAr: null,
          tradeLicenseNumber: null,
          emiratesIdNumber: null,
          passportNumber: null,
          nationality: null,
          mobile: null,
          email: null,
        },
      }),
    );

    const result = await service.extractContract(Buffer.from('pdf'), 'commercial.pdf');

    expect(result.tenant.tenantType).toBe('Individual');
    expect(result.tenant.emiratesIdNumber).toBeUndefined();
    expect(
      result.tenant.flags.some((f) => f.field === 'emiratesIdNumber' && f.status === 'missing'),
    ).toBe(true);
    // The expiry dates are never on a DMT contract — surfaced, never guessed.
    expect(
      result.tenant.flags.some((f) => f.field === 'individualProfile' && f.status === 'missing'),
    ).toBe(true);
  });

  it('throws PdfExtractionError on malformed JSON without crashing', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'not json{' }],
    });

    await expect(service.extractContract(Buffer.from('pdf'), 'bad.pdf')).rejects.toThrow(PdfExtractionError);
  });

  it('throws PdfExtractionError when a required anchor (contract number) is missing', async () => {
    mockCreate.mockResolvedValue(
      textResponse({
        ...baseExtraction,
        contract: { ...baseExtraction.contract, contractNumber: '' },
      }),
    );

    await expect(service.extractContract(Buffer.from('pdf'), 'no-anchor.pdf')).rejects.toThrow(
      PdfExtractionError,
    );
  });

  it('throws PdfExtractionError when the model refuses', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'refusal',
      usage: { input_tokens: 10, output_tokens: 0 },
      content: [],
    });

    await expect(service.extractContract(Buffer.from('pdf'), 'refused.pdf')).rejects.toThrow(PdfExtractionError);
  });

  it('throws a clear error when ANTHROPIC_API_KEY is not configured', async () => {
    configService.get.mockImplementation((key: string) => (key === 'ANTHROPIC_API_KEY' ? undefined : undefined));

    await expect(service.extractContract(Buffer.from('pdf'), 'x.pdf')).rejects.toThrow(
      /ANTHROPIC_API_KEY is not configured/,
    );
  });
});
