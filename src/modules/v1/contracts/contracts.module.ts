import { Module } from '@nestjs/common';
import { PropertiesModule } from '../properties/properties.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ContractsController } from './contracts.controller';
import { PropertyContractsController } from './property-contracts.controller';
import { TenantContractsController } from './tenant-contracts.controller';
import { ContractDocumentsController } from './contract-documents.controller';
import { ContractsService } from './contracts.service';
import { ContractDocumentsService } from './contract-documents.service';

@Module({
  imports: [PropertiesModule, TenantsModule],
  controllers: [
    ContractsController,
    PropertyContractsController,
    TenantContractsController,
    ContractDocumentsController,
  ],
  providers: [ContractsService, ContractDocumentsService],
})
export class ContractsModule {}
