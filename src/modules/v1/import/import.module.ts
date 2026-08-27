import { Module } from '@nestjs/common';
import { BuildingsModule } from '../buildings/buildings.module';
import { PropertiesModule } from '../properties/properties.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ImportController } from './import.controller';
import { ImportSessionsController } from './import-sessions.controller';
import { PdfImportController } from './pdf-import.controller';
import { GreenContractImportController } from './green-contract-import.controller';
import { FileParserService } from './services/file-parser.service';
import { TemplateService } from './services/template.service';
import { ImportSessionService } from './services/import-session.service';
import { PdfExtractionService } from './services/pdf-extraction.service';
import { PdfResolutionService } from './services/pdf-resolution.service';
import { PdfImportService } from './services/pdf-import.service';
import { GreenContractExtractionService } from './services/green-contract-extraction.service';
import { GreenContractResolutionService } from './services/green-contract-resolution.service';
import { GreenContractImportService } from './services/green-contract-import.service';
import { BuildingsImporter } from './services/importers/buildings.importer';
import { PropertiesImporter } from './services/importers/properties.importer';
import { TenantsImporter } from './services/importers/tenants.importer';
import { ContractsImporter } from './services/importers/contracts.importer';

// Named ImportFeatureModule (not ImportModule) to avoid colliding with the
// ImportModule enum (BUILDINGS/PROPERTIES/TENANTS/CONTRACTS) used throughout
// this feature's importers, services, and DTOs.
@Module({
  imports: [BuildingsModule, PropertiesModule, TenantsModule, ContractsModule],
  // Both literal-path controllers MUST be registered before ImportController:
  // Express matches routes in registration order, and ImportController's dynamic
  // `import/:module/...` pattern would otherwise swallow `import/pdf/...` and
  // `import/green-contract/...` first (module='pdf'/'green-contract' — never real
  // slugs, so it would just 400 them, but only after consuming the request with
  // the wrong file interceptor, which surfaces as a baffling "Unexpected field").
  controllers: [
    PdfImportController,
    GreenContractImportController,
    ImportController,
    ImportSessionsController,
  ],
  providers: [
    FileParserService,
    TemplateService,
    ImportSessionService,
    PdfExtractionService,
    PdfResolutionService,
    PdfImportService,
    GreenContractExtractionService,
    GreenContractResolutionService,
    GreenContractImportService,
    BuildingsImporter,
    PropertiesImporter,
    TenantsImporter,
    ContractsImporter,
  ],
})
export class ImportFeatureModule {}
