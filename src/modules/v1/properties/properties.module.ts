import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { BuildingPropertiesController } from './building-properties.controller';
import { PropertiesService } from './properties.service';

@Module({
  controllers: [PropertiesController, BuildingPropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
