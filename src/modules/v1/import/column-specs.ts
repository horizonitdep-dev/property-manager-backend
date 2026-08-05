import { ImportModule } from '../../../common/enums/import-module.enum';

export interface TemplateColumn {
  header: string;
  example: string;
}

const BUILDINGS_COLUMNS: TemplateColumn[] = [
  { header: 'Building Name', example: 'Al Noor Tower' },
  { header: 'Building Code', example: 'R6' },
  { header: 'Address', example: 'Hamdan Street, Abu Dhabi' },
  { header: 'City', example: 'Abu Dhabi' },
  { header: 'Building Type', example: 'Residential' },
  { header: 'Total Floors', example: '4' },
  { header: 'Total Units', example: '35' },
  { header: 'Construction Status', example: 'Complete' },
  { header: 'Notes', example: 'Sample row — replace with real data' },
];

const PROPERTIES_COLUMNS: TemplateColumn[] = [
  { header: 'Building Code', example: 'R6' },
  { header: 'Unit Number', example: '101' },
  { header: 'Floor', example: '1' },
  { header: 'Unit Type', example: 'Apartment' },
  { header: 'Bedrooms', example: '2' },
  { header: 'Bathrooms', example: '1' },
  { header: 'Size (sqm)', example: '85.5' },
  { header: 'Monthly Rent', example: '2500' },
  { header: 'Status', example: 'Vacant' },
  { header: 'Notes', example: '' },
];

const TENANTS_COLUMNS: TemplateColumn[] = [
  { header: 'Tenant Type', example: 'Individual' },
  { header: 'Full Name (English)', example: 'Ahmed Al Mansoori' },
  { header: 'Full Name (Arabic)', example: 'أحمد المنصوري' },
  { header: 'Phone', example: '+971501234567' },
  { header: 'Alternate Phone', example: '' },
  { header: 'Email', example: 'tenant@example.com' },
  { header: 'Nationality', example: 'UAE' },
  { header: 'Emirates ID Number', example: '784-1990-1234567-1' },
  { header: 'Emirates ID Expiry', example: '2027-01-31' },
  { header: 'Passport Number', example: 'P1234567' },
  { header: 'Passport Expiry', example: '2029-06-30' },
  { header: 'Trade License Number', example: '' },
  { header: 'Trade License Expiry', example: '' },
  { header: 'Authorized Person (English)', example: '' },
  { header: 'Authorized Person (Arabic)', example: '' },
  { header: 'Authorized Person Occupation', example: '' },
  { header: 'Authorized Person Phone', example: '' },
  { header: 'Status', example: 'Active' },
  { header: 'Notes', example: '' },
];

const CONTRACTS_COLUMNS: TemplateColumn[] = [
  { header: 'Contract Number', example: 'C-2026-001' },
  { header: 'Tenant Name (English)', example: 'Ahmed Al Mansoori' },
  { header: 'Building Code', example: 'R6' },
  { header: 'Unit Number', example: '101' },
  { header: 'Start Date', example: '2026-01-01' },
  { header: 'End Date', example: '2026-12-31' },
  { header: 'Annual Rent', example: '24000' },
  { header: 'Monthly Rent', example: '2000' },
  { header: 'Payment Frequency', example: 'Monthly' },
  { header: 'Number of Cheques', example: '' },
  { header: 'Security Deposit', example: '2000' },
  { header: 'Status', example: 'Draft' },
  { header: 'Notes', example: '' },
];

/** Tenant names must be unique, or contracts import cannot disambiguate them. Finance's
 * 12 monthly-rent columns are intentionally excluded — out of scope for this feature. */
export const TEMPLATE_NOTES: Record<ImportModule, string | null> = {
  [ImportModule.BUILDINGS]: null,
  [ImportModule.PROPERTIES]: null,
  [ImportModule.TENANTS]: null,
  [ImportModule.CONTRACTS]:
    'Tenant Name (English) must uniquely match an existing tenant. Finance/monthly-rent breakdown columns are not imported here.',
};

export const TEMPLATE_COLUMNS: Record<ImportModule, TemplateColumn[]> = {
  [ImportModule.BUILDINGS]: BUILDINGS_COLUMNS,
  [ImportModule.PROPERTIES]: PROPERTIES_COLUMNS,
  [ImportModule.TENANTS]: TENANTS_COLUMNS,
  [ImportModule.CONTRACTS]: CONTRACTS_COLUMNS,
};
