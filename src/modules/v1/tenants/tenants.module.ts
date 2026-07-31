import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantDocumentsController } from './tenant-documents.controller';
import { TenantsService } from './tenants.service';
import { TenantDocumentsService } from './tenant-documents.service';

@Module({
  controllers: [TenantsController, TenantDocumentsController],
  providers: [TenantsService, TenantDocumentsService],
})
export class TenantsModule {}
