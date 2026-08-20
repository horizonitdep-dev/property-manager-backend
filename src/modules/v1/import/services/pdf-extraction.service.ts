import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import Anthropic from '@anthropic-ai/sdk';
import { ExtractedContractDto } from '../dtos/extracted-contract.dto';
import { PdfExtractionError } from '../pdf-extraction.error';
import {
  ExtractedContractResult,
  ExtractionFlag,
  NormalizedBuildingCandidate,
  NormalizedContractCandidate,
  NormalizedTenantCandidate,
  NormalizedUnitCandidate,
} from '../pdf-extraction-result';

const MAX_OUTPUT_TOKENS = 4096;

// NOTE: This shape is enforced via the prompt below + the post-hoc ExtractedContractDto
// class-validator pass (checkAnchors + validate()) — NOT via output_config.format's
// json_schema strict mode. This schema has 21 nullable/optional fields (issueDate,
// contractValue, etc.), and Anthropic's structured-outputs schema compiler caps
// nullable/union-typed parameters at 16 ("exponential compilation cost") — confirmed
// against the live API. Rather than degrade the schema's fidelity to fit that cap,
// extraction relies on the same prompt+validate pattern as every other guardrail in
// this service; class-validator remains the actual safety net regardless.
const EXTRACTION_PROMPT = `You are extracting structured data from a DMT (Abu Dhabi Real Estate Centre) tenancy contract PDF. Return ONLY JSON, no prose, no markdown fences, matching exactly this shape:

{
  "contract": {
    "contractNumber": "string",
    "issueDate": "YYYY-MM-DD or null",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "annualRent": number,
    "contractValue": number or null,
    "securityDeposit": number or null,
    "paymentMethod": "string, e.g. Cheque / Cash / Cash And Cheque, exactly as written",
    "numberOfPayments": number or null,
    "contractType": "string or null",
    "waterElectricityBill": number or null,
    "occupants": "string or null"
  },
  "tenant": {
    "companyNameEn": "string or null",
    "companyNameAr": "string or null",
    "individualNameEn": "string or null",
    "individualNameAr": "string or null",
    "tradeLicenseNumber": "string or null",
    "emiratesIdNumber": "string or null",
    "passportNumber": "string or null",
    "nationality": "string or null",
    "mobile": "string or null",
    "email": "string or null"
  },
  "building": {
    "propertyRegistrationNo": "string (PRP...)",
    "zone": "string or null",
    "sector": "string or null",
    "plotNo": "string or null",
    "onwaniAddress": "string or null"
  },
  "units": [
    {
      "unitNumber": "string",
      "unitType": "string, e.g. SHOP / STORE / WORKSHOP / OFFICE",
      "areaSqm": number or null,
      "premiseNo": "string or null",
      "unitRegNo": "string or null"
    }
  ]
}

Rules:
- Extract building info from the "Property Details" section, all units from "Units Details" (there may be several — return every one in the "units" array), tenant info from "Tenant Details", and contract terms from "Contract Details".
- Every key above must be present. Use null (not an empty string, not a guess) for anything not present on the document.
- Dates: normalize startDate, endDate, and issueDate to ISO format YYYY-MM-DD.
- Preserve Arabic text verbatim (do not transliterate) in every *Ar field.
- For an individual tenant, extract emiratesIdNumber from the Tenant Details section — it is usually labelled "Emirates ID" / "EID" / "ID No." / Arabic "رقم الهوية", and is typically formatted 784-YYYY-NNNNNNN-N. Residential contracts normally carry it; commercial ones often do not. Extract passportNumber and nationality the same way when shown. Use null when a field is genuinely absent — never reuse the trade licence, contract, or unit registration number as an Emirates ID.
- Never invent trade licence expiry, authorized person details, occupation, or any Emirates ID / passport EXPIRY date — these are commonly absent from DMT PDFs and must be left null, not guessed.
- Report paymentMethod and numberOfPayments exactly as written on the document — do not map them to an internal enum yourself, that happens downstream.
- The Lessor/landlord section is informational only — do not put lessor details in the tenant object.`;

@Injectable()
export class PdfExtractionService {
  private readonly logger = new Logger(PdfExtractionService.name);
  private client: Anthropic | null = null;

  constructor(private readonly configService: ConfigService) {}

  async extractContract(fileBuffer: Buffer, fileName: string): Promise<ExtractedContractResult> {
    const client = this.getClient();
    const model = this.configService.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-5');

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
        },
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
      throw new PdfExtractionError(fileName, `Anthropic API call failed: ${(error as Error).message}`);
    }

    this.logger.log('PDF extraction model call', {
      fileName,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      action: 'PDF_EXTRACTION_USAGE',
    });

    if (response.stop_reason === 'refusal') {
      throw new PdfExtractionError(fileName, 'Model declined to process this document');
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new PdfExtractionError(fileName, 'Model returned no text output');
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(this.extractJsonText(textBlock.text));
    } catch {
      this.logger.warn(`Malformed JSON from model for ${fileName}: ${textBlock.text.slice(0, 2000)}`);
      throw new PdfExtractionError(fileName, 'Model returned malformed JSON');
    }

    const extracted = plainToInstance(ExtractedContractDto, rawJson);
    const violations = await validate(extracted);
    if (violations.length > 0) {
      const summary = violations
        .map((v) => `${v.property}: ${Object.values(v.constraints ?? {}).join(', ')}`)
        .join('; ');
      throw new PdfExtractionError(fileName, `Extraction output failed schema validation: ${summary}`);
    }

    this.checkAnchors(extracted, fileName);

    return this.normalize(extracted, fileName, {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  // Without output_config.format enforcing strict JSON (dropped due to the API's
  // 16-union-field schema cap, see EXTRACTION_PROMPT comment above), the model
  // occasionally wraps its JSON reply in markdown fences or a short lead-in
  // sentence despite being told not to. Strip fences and take the outermost
  // {...} span rather than failing extraction outright for a cosmetic wrapper.
  private extractJsonText(text: string): string {
    let trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) {
      trimmed = fenceMatch[1].trim();
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return trimmed;
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException(
        'ANTHROPIC_API_KEY is not configured — PDF contract ingestion is unavailable.',
      );
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  /** §5 step 2: reject when the model misses the anchors a usable extraction can't do without. */
  private checkAnchors(extracted: ExtractedContractDto, fileName: string): void {
    if (!extracted.contract.contractNumber?.trim()) {
      throw new PdfExtractionError(fileName, 'Missing required anchor: contract number');
    }
    if (!extracted.units.some((unit) => unit.unitNumber?.trim())) {
      throw new PdfExtractionError(fileName, 'Missing required anchor: unit number');
    }
    if (!extracted.tenant.companyNameEn?.trim() && !extracted.tenant.individualNameEn?.trim()) {
      throw new PdfExtractionError(fileName, 'Missing required anchor: tenant name');
    }
  }

  private normalize(
    extracted: ExtractedContractDto,
    fileName: string,
    usage: { inputTokens: number; outputTokens: number },
  ): ExtractedContractResult {
    const building = this.normalizeBuilding(extracted);
    const units = extracted.units.map((unit) => this.normalizeUnit(unit));
    const tenant = this.normalizeTenant(extracted);
    const contract = this.normalizeContract(extracted, units);

    return {
      sourceFileName: fileName,
      building,
      units,
      tenant,
      contract,
      usage,
      rawExtraction: extracted,
    };
  }

  private normalizeBuilding(extracted: ExtractedContractDto): NormalizedBuildingCandidate {
    const flags: ExtractionFlag[] = [];
    const { propertyRegistrationNo, onwaniAddress, zone, sector, plotNo } = extracted.building;

    const code = this.deriveBuildingCode(sector, plotNo, propertyRegistrationNo, flags);

    const address =
      onwaniAddress?.trim() ||
      [zone, sector, plotNo].filter(Boolean).join(', ') ||
      (() => {
        flags.push({ field: 'address', status: 'missing', note: 'Not present on the PDF' });
        return 'Address not extracted — please complete';
      })();
    if (onwaniAddress?.trim()) {
      flags.push({ field: 'address', status: 'ok' });
    } else if (zone || sector || plotNo) {
      flags.push({
        field: 'address',
        status: 'derived',
        note: 'Composed from zone/sector/plot — Onwani address not present',
      });
    }

    flags.push({
      field: 'name',
      status: 'guessed',
      note: 'DMT PDFs do not carry a building name — set to the building code',
    });

    flags.push({
      field: 'city',
      status: 'missing',
      note: 'Not present on DMT PDFs — confirm before committing',
    });

    flags.push({
      field: 'buildingType',
      status: 'guessed',
      note: 'DMT PDFs do not state building type — defaulted to Commercial (units are typically retail/office)',
    });

    flags.push({
      field: 'totalFloors',
      status: 'missing',
      note: 'Not present on DMT PDFs — confirm before committing',
    });

    return {
      propertyRegistrationNo,
      code,
      name: code,
      address,
      city: 'Abu Dhabi',
      flags,
    };
  }

  /** Building identity is Sector + Plot No. (e.g. "M17-108") when the PDF has both —
   * that's how the buildings in this portfolio are actually named/coded on-site.
   * Falls back to the property registration number only when either is absent. */
  private deriveBuildingCode(
    sector: string | null | undefined,
    plotNo: string | null | undefined,
    propertyRegistrationNo: string,
    flags: ExtractionFlag[],
  ): string {
    const trimmedSector = sector?.trim();
    const trimmedPlotNo = plotNo?.trim();

    if (trimmedSector && trimmedPlotNo) {
      flags.push({
        field: 'code',
        status: 'ok',
        note: `Derived from Plot No. '${trimmedPlotNo}' + Sector '${trimmedSector}'`,
      });
      // Plot first, then sector — the convention the existing (Excel-imported)
      // buildings use, e.g. plot R6 in sector MZW16 is 'R6-MZW16'. Emitting the
      // other order registered a second building for one that already existed.
      // Matching is order-insensitive regardless (see buildCodeIndex), so an
      // existing building is reused whichever way round its code was written.
      return this.toBuildingCode(`${trimmedPlotNo}-${trimmedSector}`);
    }

    flags.push({
      field: 'code',
      status: 'guessed',
      note: 'Sector/Plot No. not present on the PDF — fell back to the property registration number',
    });
    return this.toBuildingCode(propertyRegistrationNo);
  }

  private toBuildingCode(value: string): string {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '-');
  }

  private normalizeUnit(unit: { unitNumber: string; unitType: string; areaSqm?: number | null }): NormalizedUnitCandidate {
    const flags: ExtractionFlag[] = [];
    const { label, guessed } = this.mapUnitType(unit.unitType);
    flags.push({
      field: 'unitType',
      status: guessed ? 'guessed' : 'ok',
      note: guessed ? `DMT label '${unit.unitType}' mapped to best fit` : undefined,
    });

    // CreatePropertyDto allows sizeSqm to be absent but requires it to be
    // POSITIVE when present, so a literal 0 (which DMT prints when the area
    // simply isn't recorded) is not a usable measurement — passing it straight
    // through fails validation and blocks the row. Treat it as "not stated".
    const hasArea = unit.areaSqm != null && unit.areaSqm > 0;
    if (unit.areaSqm == null) {
      flags.push({ field: 'sizeSqm', status: 'missing', note: 'Not present on the PDF' });
    } else if (!hasArea) {
      flags.push({
        field: 'sizeSqm',
        status: 'missing',
        note: `The PDF records the area as ${unit.areaSqm} — imported blank rather than as a real measurement; please confirm the actual size`,
      });
    }

    return {
      unitNumber: unit.unitNumber,
      unitType: label,
      sizeSqm: hasArea ? unit.areaSqm ?? undefined : undefined,
      flags,
    };
  }

  /** §3 mapping rule: SHOP→Shop; STORE/مستودع→Warehouse; WORKSHOP/ورشة→Warehouse; OFFICE→Office; else best-fit + flag. */
  private mapUnitType(rawType: string): { label: string; guessed: boolean } {
    const normalized = rawType.trim().toLowerCase();

    // "workshop" and "showroom" must be checked before the generic "shop"
    // substring match below — "workshop".includes('shop') is true, so checking
    // shop first would misclassify every workshop as a plain shop.
    if (normalized.includes('workshop') || rawType.includes('ورشة')) {
      return { label: 'Workshop', guessed: false };
    }
    if (normalized.includes('showroom') || normalized.includes('show room') || rawType.includes('معرض')) {
      return { label: 'Showroom', guessed: false };
    }
    if (normalized.includes('store') || rawType.includes('مستودع')) {
      return { label: 'Store', guessed: false };
    }
    if (normalized.includes('camp') || rawType.includes('سكن عمال')) {
      return { label: 'Camp Rooms', guessed: false };
    }
    if (normalized.includes('shop')) return { label: 'Shop', guessed: false };
    if (normalized.includes('office')) return { label: 'Office', guessed: false };
    if (normalized.includes('studio')) return { label: 'Studio', guessed: true };
    if (normalized.includes('roof')) return { label: 'Roof Unit', guessed: true };
    if (normalized.includes('apartment') || normalized.includes('flat')) {
      return { label: 'Apartment', guessed: true };
    }
    if (normalized.includes('warehouse')) return { label: 'Warehouse', guessed: true };

    // No confident match — pass the raw label through. The downstream PropertiesImporter
    // runs the exact same enum mapping and will surface a clear "not recognized" row error
    // rather than this service silently fabricating a type.
    return { label: rawType, guessed: true };
  }

  private normalizeTenant(extracted: ExtractedContractDto): NormalizedTenantCandidate {
    const flags: ExtractionFlag[] = [];
    const {
      companyNameEn,
      companyNameAr,
      individualNameEn,
      individualNameAr,
      mobile,
      email,
      tradeLicenseNumber,
      emiratesIdNumber,
      passportNumber,
      nationality,
    } = extracted.tenant;

    const isCompany = Boolean(companyNameEn?.trim());
    const nameEn = (isCompany ? companyNameEn : individualNameEn)?.trim() ?? '';
    const nameAr = (isCompany ? companyNameAr : individualNameAr)?.trim() || undefined;

    if (!mobile?.trim()) {
      flags.push({ field: 'phone', status: 'missing', note: 'Not present on the PDF' });
    }
    if (isCompany && !tradeLicenseNumber?.trim()) {
      flags.push({ field: 'tradeLicenseNumber', status: 'missing', note: 'Not present on the PDF' });
    }
    if (isCompany) {
      flags.push({
        field: 'companyProfile',
        status: 'missing',
        note:
          'Trade licence expiry, authorized person, and occupation are commonly absent from DMT PDFs and are left blank — imports flag the tenant profileIncomplete rather than blocking the row',
      });
    }

    if (!isCompany) {
      if (emiratesIdNumber?.trim()) {
        flags.push({ field: 'emiratesIdNumber', status: 'ok' });
      } else {
        flags.push({
          field: 'emiratesIdNumber',
          status: 'missing',
          note:
            'No Emirates ID printed on this contract (common on commercial lets) — the tenant imports without one and should be completed later',
        });
      }
      flags.push({
        field: 'individualProfile',
        status: 'missing',
        note:
          'Emirates ID expiry and passport expiry are never printed on DMT contracts and are left blank — imports flag the tenant rather than blocking the row',
      });
    }

    return {
      tenantType: isCompany ? 'Company' : 'Individual',
      nameEn,
      nameAr,
      phone: mobile?.trim() || undefined,
      email: email?.trim() || undefined,
      tradeLicenseNumber: isCompany ? tradeLicenseNumber?.trim() || undefined : undefined,
      emiratesIdNumber: isCompany ? undefined : emiratesIdNumber?.trim() || undefined,
      passportNumber: isCompany ? undefined : passportNumber?.trim() || undefined,
      nationality: nationality?.trim() || undefined,
      flags,
    };
  }

  private normalizeContract(
    extracted: ExtractedContractDto,
    units: NormalizedUnitCandidate[],
  ): NormalizedContractCandidate {
    const flags: ExtractionFlag[] = [];
    const { contractNumber, startDate, endDate, annualRent, paymentMethod, numberOfPayments } = extracted.contract;

    const monthlyRent = Math.round(annualRent / 12);
    flags.push({
      field: 'monthlyRent',
      status: 'derived',
      note: 'DMT PDFs do not state a monthly figure — computed as round(annualRent / 12)',
    });

    const { paymentFrequency, numberOfCheques, guessed, chequeCountGuessed, cashNote } =
      this.mapPaymentMethod(paymentMethod, numberOfPayments);
    flags.push({
      field: 'paymentFrequency',
      status: guessed ? 'guessed' : 'ok',
      note: guessed ? `DMT payment method '${paymentMethod}' mapped by inferred cadence` : undefined,
    });
    if (chequeCountGuessed) {
      flags.push({
        field: 'numberOfCheques',
        status: 'guessed',
        note: `The PDF does not state a usable number of payments (${numberOfPayments ?? 'blank'}) — assumed 1; please confirm`,
      });
    }

    const notesParts: string[] = [];
    if (extracted.contract.contractType) notesParts.push(`DMT contract type: ${extracted.contract.contractType}`);
    if (extracted.contract.issueDate) notesParts.push(`Issue date: ${extracted.contract.issueDate}`);
    if (extracted.contract.contractValue != null) {
      notesParts.push(`Contract value: ${extracted.contract.contractValue}`);
    }
    if (extracted.contract.waterElectricityBill != null) {
      notesParts.push(`Water/electricity: ${extracted.contract.waterElectricityBill}`);
    }
    if (extracted.contract.occupants) notesParts.push(`Occupants: ${extracted.contract.occupants}`);
    if (cashNote) notesParts.push(cashNote);
    if (units.length > 1) {
      const others = units
        .slice(1)
        .map((u) => u.unitNumber)
        .join(', ');
      notesParts.push(`Multi-unit contract — also covers unit(s): ${others}`);
    }
    notesParts.push('Imported from DMT PDF — Finance monthly-rent breakdown not included (out of scope).');

    return {
      contractNumber,
      startDate,
      endDate,
      annualRent,
      monthlyRent,
      paymentFrequency,
      numberOfCheques,
      securityDeposit: extracted.contract.securityDeposit ?? undefined,
      notes: notesParts.join(' | '),
      flags,
    };
  }

  /** §3 mapping rule for paymentMethod → paymentFrequency. */
  private mapPaymentMethod(
    paymentMethod: string,
    numberOfPayments: number | null | undefined,
  ): {
    paymentFrequency: string;
    numberOfCheques?: number;
    guessed: boolean;
    chequeCountGuessed?: boolean;
    cashNote?: string;
  } {
    const normalized = paymentMethod.trim().toLowerCase();

    if (normalized === 'cheque' || normalized.includes('cheque')) {
      const hasCashToo = normalized.includes('cash');
      // A cheque contract has at least one cheque by definition, but DMT
      // sometimes prints 0 or omits the count. Passing that through fails
      // CreateContractDto's @Min(1) AND the service's "numberOfCheques is
      // required when paymentFrequency is CHEQUES" rule, blocking the row over
      // a number the document never stated. Assume the minimum and flag it.
      const stated = numberOfPayments != null && numberOfPayments > 0;
      return {
        paymentFrequency: 'Cheques',
        numberOfCheques: stated ? numberOfPayments : 1,
        guessed: false,
        chequeCountGuessed: !stated,
        cashNote: hasCashToo ? 'Payment method on PDF: Cash And Cheque' : undefined,
      };
    }

    if (normalized === 'cash') {
      if (!numberOfPayments || numberOfPayments <= 1) {
        return { paymentFrequency: 'Single Payment', guessed: false };
      }
      // Spec doesn't define a cash-with-multiple-payments mapping — infer the closest
      // recurring cadence from the payment count and flag it for manual confirmation.
      const byCount: Record<number, string> = { 12: 'Monthly', 4: 'Quarterly', 2: 'Bi-Annual', 1: 'Annual' };
      return { paymentFrequency: byCount[numberOfPayments] ?? 'Annual', guessed: true };
    }

    return { paymentFrequency: 'Single Payment', guessed: true };
  }
}
