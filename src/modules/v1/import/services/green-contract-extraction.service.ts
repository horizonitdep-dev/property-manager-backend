import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import Anthropic from '@anthropic-ai/sdk';
import { TenantType } from '../../../../common/enums/tenant-type.enum';
import { ExtractedGreenContractDto } from '../dtos/extracted-green-contract.dto';
import { GreenContractExtractionError } from '../green-contract-extraction.error';
import {
  ExtractedGreenContractResult,
  NormalizedGreenBuilding,
  NormalizedGreenContract,
  NormalizedGreenTenant,
  NormalizedGreenUnit,
} from '../green-contract-extraction-result';
import { ExtractionFlag } from '../pdf-extraction-result';

/**
 * Kept short on purpose (spec §5.4): every call re-sends it, so field-by-field
 * descriptions and few-shot examples would inflate the cost of each contract.
 * The schema block below does most of the work.
 */
const EXTRACTION_PROMPT = `You extract structured data from an internal (non-government) tenancy contract PDF. Return ONLY the JSON below. No prose, no markdown fences.

Rules:
- tenant.type = "COMPANY" when the tenant line has a trade licence / "CN:" number; "INDIVIDUAL" when it has an Emirates ID (784-YYYY-NNNNNNN-N).
- Preserve Arabic verbatim in *Ar fields. Never transliterate.
- building.code and unit.unitNumber come from the subject line: "Flat 101 - R6" gives code "R6", unitNumber "101". A middle name ("Flat 07 - Mezan - R19") goes in building.nameQualifier.
- Dates as YYYY-MM-DD.
- paymentFrequencyRaw: copy the payment phrase verbatim, e.g. "4 installments" or "2250 AED Monthly". Do not interpret it.
- Use null for anything not present. Never invent a value.

{
  "internalReference": "string|null",
  "building": { "code": "string", "nameQualifier": "string|null" },
  "unit": { "unitNumber": "string" },
  "tenant": {
    "type": "INDIVIDUAL|COMPANY",
    "nameEn": "string|null",
    "nameAr": "string|null",
    "phone": "string|null",
    "emiratesIdNumber": "string|null",
    "tradeLicenseNumber": "string|null",
    "authorizedPersonNameEn": "string|null",
    "authorizedPersonNameAr": "string|null"
  },
  "contract": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "annualRent": number,
    "monthlyRent": number|null,
    "paymentFrequencyRaw": "string",
    "installmentsCount": number|null,
    "observations": "string|null",
    "utilitiesNote": "string|null"
  }
}`;

/**
 * paymentFrequencyRaw -> PaymentFrequency label, applied in code rather than by
 * the model (§5.5). The model reports the phrase; interpreting it is business
 * logic and belongs where it can be tested.
 *
 * Order matters: the installments pattern is checked first because a phrase like
 * "4 installments yearly" contains both signals and the installment count is the
 * more specific fact.
 */
const FREQUENCY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(\d+)\s*installments?/i, label: 'Cheques' },
  { pattern: /month/i, label: 'Monthly' },
  { pattern: /quarter/i, label: 'Quarterly' },
  { pattern: /bi[-\s]?annual|semi[-\s]?annual/i, label: 'Bi-Annual' },
  { pattern: /year|annual/i, label: 'Annual' },
  { pattern: /single|one\s+payment|lump\s*sum/i, label: 'Single Payment' },
];

@Injectable()
export class GreenContractExtractionService {
  private readonly logger = new Logger(GreenContractExtractionService.name);
  private client: Anthropic | null = null;

  constructor(private readonly configService: ConfigService) {}

  async extract(fileBuffer: Buffer, fileName: string): Promise<ExtractedGreenContractResult> {
    const client = this.getClient();
    const model = this.configService.get<string>(
      'ANTHROPIC_MODEL_GREEN_CONTRACT',
      'claude-haiku-4-5-20251001',
    );
    const maxTokens = Number(this.configService.get('ANTHROPIC_MAX_TOKENS_GREEN_CONTRACT', 1500));
    const temperature = Number(this.configService.get('ANTHROPIC_TEMPERATURE_GREEN_CONTRACT', 0));

    const startedAt = Date.now();
    let response: Anthropic.Message;

    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: fileBuffer.toString('base64'),
                },
              },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
      });
    } catch (error) {
      throw new GreenContractExtractionError(
        fileName,
        `Anthropic API call failed: ${(error as Error).message}`,
      );
    }

    // §5.6/§12: per-call usage, so cost per contract is visible in production.
    this.logger.log('Green Contract extraction model call', {
      fileName,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      elapsedMs: Date.now() - startedAt,
      action: 'GREEN_CONTRACT_EXTRACTION_USAGE',
    });

    if (response.stop_reason === 'refusal') {
      throw new GreenContractExtractionError(fileName, 'Model declined to process this document');
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new GreenContractExtractionError(fileName, 'Model returned no text output');
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(this.extractJsonText(textBlock.text));
    } catch {
      this.logger.warn(
        `Malformed JSON from model for ${fileName}: ${textBlock.text.slice(0, 2000)}`,
      );
      throw new GreenContractExtractionError(fileName, 'Model returned malformed JSON');
    }

    const extracted = plainToInstance(ExtractedGreenContractDto, rawJson);
    const violations = await validate(extracted);
    if (violations.length > 0) {
      const summary = violations
        .map((v) => `${v.property}: ${Object.values(v.constraints ?? {}).join(', ')}`)
        .join('; ');
      throw new GreenContractExtractionError(
        fileName,
        `Extraction output failed schema validation: ${summary}`,
      );
    }

    this.checkAnchors(extracted, fileName);

    return this.normalize(extracted, fileName, {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  /**
   * The model is told not to wrap its reply, but without API-enforced structured
   * output it occasionally adds a fence or a lead-in sentence anyway. Strip those
   * rather than failing the row over a cosmetic wrapper.
   */
  private extractJsonText(text: string): string {
    let trimmed = text.trim();

    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    if (fence) trimmed = fence[1].trim();

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    return first !== -1 && last > first ? trimmed.slice(first, last + 1) : trimmed;
  }

  /**
   * Fields with no sensible fallback. Without a building code and unit number
   * there is nothing to attach the contract to, and the derived contract number
   * could not be built.
   */
  private checkAnchors(extracted: ExtractedGreenContractDto, fileName: string): void {
    if (!extracted.building?.code?.trim()) {
      throw new GreenContractExtractionError(fileName, 'Missing required anchor: building code');
    }
    if (!extracted.unit?.unitNumber?.trim()) {
      throw new GreenContractExtractionError(fileName, 'Missing required anchor: unit number');
    }

    const tenant = extracted.tenant;
    const hasIdentity =
      Boolean(tenant?.emiratesIdNumber?.trim()) || Boolean(tenant?.tradeLicenseNumber?.trim());

    // §11: neither a CN nor an EID means the tenant cannot be typed or deduped,
    // so the row is refused rather than guessed at.
    if (!hasIdentity && !tenant?.nameEn?.trim()) {
      throw new GreenContractExtractionError(
        fileName,
        'Cannot determine tenant type: the contract carries neither a trade licence number nor an Emirates ID',
      );
    }
  }

  private normalize(
    extracted: ExtractedGreenContractDto,
    fileName: string,
    usage: { inputTokens: number; outputTokens: number },
  ): ExtractedGreenContractResult {
    const building = this.normalizeBuilding(extracted);
    const unit: NormalizedGreenUnit = {
      unitNumber: extracted.unit.unitNumber.trim(),
      flags: [{ field: 'unitNumber', status: 'ok' }],
    };
    const tenant = this.normalizeTenant(extracted);
    const contract = this.normalizeContract(extracted, building.code, unit.unitNumber);

    return {
      sourceFileName: fileName,
      building,
      unit,
      tenant,
      contract,
      usage,
      rawExtraction: extracted,
    };
  }

  private normalizeBuilding(extracted: ExtractedGreenContractDto): NormalizedGreenBuilding {
    const flags: ExtractionFlag[] = [];
    const code = extracted.building.code.trim().toUpperCase();
    const qualifier = extracted.building.nameQualifier?.trim();

    flags.push({ field: 'code', status: 'ok' });

    if (qualifier) {
      flags.push({ field: 'name', status: 'ok', note: `Building name taken from the subject line` });
    } else {
      flags.push({
        field: 'name',
        status: 'derived',
        note: 'No building name on the contract — using the code as the name',
      });
    }

    return { code, name: qualifier || code, flags };
  }

  private normalizeTenant(extracted: ExtractedGreenContractDto): NormalizedGreenTenant {
    const flags: ExtractionFlag[] = [];
    const t = extracted.tenant;
    const isCompany = t.type === TenantType.COMPANY;

    if (!t.phone?.trim()) {
      flags.push({ field: 'phone', status: 'missing', note: 'Not present on the contract' });
    }

    if (isCompany) {
      // Same relaxed-import path the CSV importer uses: these are routinely absent
      // from an internal contract and must not block the row (§3).
      flags.push({
        field: 'companyProfile',
        status: 'missing',
        note:
          'Trade licence expiry, authorized person and occupation are not on Green Contracts — the tenant imports flagged profileIncomplete rather than blocking the row',
      });
    } else if (!t.emiratesIdNumber?.trim()) {
      flags.push({
        field: 'emiratesIdNumber',
        status: 'missing',
        note: 'No Emirates ID printed on this contract — complete the tenant later',
      });
    } else {
      flags.push({ field: 'emiratesIdNumber', status: 'ok' });
    }

    return {
      tenantType: isCompany ? 'Company' : 'Individual',
      nameEn: t.nameEn?.trim() ?? '',
      nameAr: t.nameAr?.trim() || undefined,
      phone: t.phone?.trim() || undefined,
      emiratesIdNumber: isCompany ? undefined : t.emiratesIdNumber?.trim() || undefined,
      tradeLicenseNumber: isCompany ? t.tradeLicenseNumber?.trim() || undefined : undefined,
      authorizedPersonNameEn: isCompany ? t.authorizedPersonNameEn?.trim() || undefined : undefined,
      authorizedPersonNameAr: isCompany ? t.authorizedPersonNameAr?.trim() || undefined : undefined,
      flags,
    };
  }

  private normalizeContract(
    extracted: ExtractedGreenContractDto,
    buildingCode: string,
    unitNumber: string,
  ): NormalizedGreenContract {
    const flags: ExtractionFlag[] = [];
    const c = extracted.contract;

    // §3: Green Contracts have no DMT number, so one is derived. Editable in the
    // preview before commit.
    const contractNumber = `GC-${buildingCode}-${unitNumber}`.toUpperCase().replace(/\s+/g, '');
    flags.push({
      field: 'contractNumber',
      status: 'derived',
      note: 'Green Contract reference — derived from the building code and unit number',
    });

    const { label: paymentFrequency, numberOfCheques, guessed } = this.mapPaymentFrequency(
      c.paymentFrequencyRaw,
      c.installmentsCount,
    );
    flags.push({
      field: 'paymentFrequency',
      status: guessed ? 'guessed' : 'ok',
      note: guessed
        ? `Could not recognise "${c.paymentFrequencyRaw}" — defaulted to Monthly, please confirm`
        : undefined,
    });

    // The contract states an annual figure; a monthly one is only sometimes given.
    const monthlyRent = c.monthlyRent ?? Math.round(c.annualRent / 12);
    if (c.monthlyRent == null) {
      flags.push({
        field: 'monthlyRent',
        status: 'derived',
        note: 'Not stated on the contract — computed as round(annualRent / 12)',
      });
    }

    const noteParts = [c.observations?.trim(), c.utilitiesNote?.trim()].filter(Boolean);
    if (extracted.internalReference?.trim()) {
      noteParts.push(`Landlord reference: ${extracted.internalReference.trim()}`);
    }
    noteParts.push('Imported from a Green Contract PDF.');

    return {
      contractNumber,
      startDate: c.startDate,
      endDate: c.endDate,
      annualRent: c.annualRent,
      monthlyRent,
      paymentFrequency,
      numberOfCheques,
      notes: noteParts.join(' | '),
      flags,
    };
  }

  private mapPaymentFrequency(
    raw: string,
    installmentsCount: number | null | undefined,
  ): { label: string; numberOfCheques?: number; guessed: boolean } {
    for (const { pattern, label } of FREQUENCY_PATTERNS) {
      const match = pattern.exec(raw ?? '');
      if (!match) continue;

      if (label !== 'Cheques') return { label, guessed: false };

      // Prefer the count the model reported; fall back to the digits in the phrase.
      const count = installmentsCount ?? Number(match[1]);
      return {
        label,
        numberOfCheques: Number.isFinite(count) && count > 0 ? count : 1,
        guessed: false,
      };
    }

    // Unrecognised: default rather than fail, and flag it for confirmation (§5.5).
    return { label: 'Monthly', guessed: true };
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;

    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException(
        'ANTHROPIC_API_KEY is not configured — Green Contract import is unavailable',
      );
    }

    this.client = new Anthropic({ apiKey });
    return this.client;
  }
}
