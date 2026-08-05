import { Module } from '@nestjs/common';
import { BuildingsModule } from '../buildings/buildings.module';
import { PropertiesModule } from '../properties/properties.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ImportController } from './import.controller';
import { ImportSessionsController } from './import-sessions.controller';
import { FileParserService } from './services/file-parser.service';
import { TemplateService } from './services/template.service';
import { ImportSessionService } from './services/import-session.service';
import { BuildingsImporter } from './services/importers/buildings.importer';
import { PropertiesImporter } from './services/importers/properties.importer';
import { TenantsImporter } from './services/importers/tenants.importer';
import { ContractsImporter } from './services/importers/contracts.importer';

// Named ImportFeatureModule (not ImportModule) to avoid colliding with the
// ImportModule enum (BUILDINGS/PROPERTIES/TENANTS/CONTRACTS) used throughout
// this feature's importers, services, and DTOs.
@Module({
  imports: [BuildingsModule, PropertiesModule, TenantsModule, ContractsModule],
  controllers: [ImportController, ImportSessionsController],
  providers: [
    FileParserService,
    TemplateService,
    ImportSessionService,
    BuildingsImporter,
    PropertiesImporter,
    TenantsImporter,
    ContractsImporter,
  ],
})
export class ImportFeatureModule {}
