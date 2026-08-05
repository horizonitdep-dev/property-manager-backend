import { ImportModule } from '../../../common/enums/import-module.enum';

export const IMPORT_MODULE_SLUGS = ['buildings', 'properties', 'tenants', 'contracts'] as const;
export type ImportModuleSlug = (typeof IMPORT_MODULE_SLUGS)[number];

const SLUG_TO_MODULE: Record<ImportModuleSlug, ImportModule> = {
  buildings: ImportModule.BUILDINGS,
  properties: ImportModule.PROPERTIES,
  tenants: ImportModule.TENANTS,
  contracts: ImportModule.CONTRACTS,
};

const MODULE_TO_SLUG: Record<ImportModule, ImportModuleSlug> = {
  [ImportModule.BUILDINGS]: 'buildings',
  [ImportModule.PROPERTIES]: 'properties',
  [ImportModule.TENANTS]: 'tenants',
  [ImportModule.CONTRACTS]: 'contracts',
};

export function isImportModuleSlug(value: string): value is ImportModuleSlug {
  return (IMPORT_MODULE_SLUGS as readonly string[]).includes(value);
}

export function slugToImportModule(slug: ImportModuleSlug): ImportModule {
  return SLUG_TO_MODULE[slug];
}

export function importModuleToSlug(module: ImportModule): ImportModuleSlug {
  return MODULE_TO_SLUG[module];
}
