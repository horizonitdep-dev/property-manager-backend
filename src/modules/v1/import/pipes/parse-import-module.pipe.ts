import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ImportModule } from '../../../../common/enums/import-module.enum';
import { IMPORT_MODULE_SLUGS, ImportModuleSlug, isImportModuleSlug, slugToImportModule } from '../import-module-slug';

/** Validates the `:module` route segment and transforms it into the ImportModule enum. */
@Injectable()
export class ParseImportModulePipe implements PipeTransform<string, ImportModule> {
  transform(value: string): ImportModule {
    if (!isImportModuleSlug(value)) {
      throw new BadRequestException(
        `Unknown import module '${value}'. Must be one of: ${IMPORT_MODULE_SLUGS.join(', ')}`,
      );
    }
    return slugToImportModule(value as ImportModuleSlug);
  }
}
