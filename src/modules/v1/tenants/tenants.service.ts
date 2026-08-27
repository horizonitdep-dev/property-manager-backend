import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CreateTenantDto } from './dtos/create-tenant.dto';
import { UpdateTenantDto } from './dtos/update-tenant.dto';
import { ListTenantsQueryDto } from './dtos/list-tenants.query.dto';
import { PaginatedResult } from '../../../common/dtos/pagination.dto';
import { getMissingTenantTypeFields, isTenantProfileIncomplete } from './validators/tenant-type-fields.validator';

const documentCountInclude = {
  _count: { select: { documents: { where: { deletedAt: null } } } },
};

const documentsInclude = {
  documents: { where: { deletedAt: null }, orderBy: { uploadedAt: 'desc' as const } },
};

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListTenantsQueryDto): Promise<PaginatedResult<object>> {
    const {
      page = 1,
      limit = 10,
      search,
      tenantType,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(tenantType && { tenantType }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { nameEn: { contains: search, mode: 'insensitive' } },
          { nameAr: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: documentCountInclude,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: items.map((item) => this.toListItem(item)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      include: documentsInclude,
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return { ...tenant, profileIncomplete: isTenantProfileIncomplete(tenant) };
  }

  async create(
    dto: CreateTenantDto,
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
    /**
     * Field names to exclude from the required-fields check below. Empty by default,
     * so normal callers (the controller) get the exact same enforcement as always.
     * Only TenantsImporter passes IMPORT_OPTIONAL_COMPANY_FIELDS here, for the
     * import path's relaxed COMPANY validation — see that constant's own comment.
     */
    exemptFromRequiredCheck: readonly string[] = [],
  ) {
    // Belt-and-braces: the DTO-level @RequiredForTenantType constraint already
    // enforces this over HTTP, but the service shouldn't rely on callers
    // always going through the ValidationPipe (see §6 — do not rely on the
    // DB alone, and don't rely solely on the DTO layer either).
    const missing = getMissingTenantTypeFields(dto).filter(
      (field) => !exemptFromRequiredCheck.includes(field),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        missing.map((field) => `${field} is required when tenantType is ${dto.tenantType}`),
      );
    }

    const tenant = await client.tenant.create({
      data: {
        ...dto,
        ...this.toDateFields(dto),
        createdById: userId,
      },
      include: documentsInclude,
    });

    this.logger.log('Tenant created', {
      tenantId: tenant.id,
      tenantType: tenant.tenantType,
      userId,
      action: 'CREATE_TENANT',
    });

    return { ...tenant, profileIncomplete: isTenantProfileIncomplete(tenant) };
  }

  async update(id: string, dto: UpdateTenantDto, userId: string) {
    const current = await this.findOne(id);

    const merged = { ...current, ...dto };
    const missing = getMissingTenantTypeFields(merged);
    if (missing.length > 0) {
      throw new BadRequestException(
        missing.map((field) => `${field} is required when tenantType is ${merged.tenantType}`),
      );
    }

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { ...dto, ...this.toDateFields(dto), updatedById: userId },
      include: documentsInclude,
    });

    this.logger.log('Tenant updated', {
      tenantId: id,
      userId,
      action: 'UPDATE_TENANT',
    });

    return { ...tenant, profileIncomplete: isTenantProfileIncomplete(tenant) };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
      include: documentsInclude,
    });

    this.logger.log('Tenant soft deleted', {
      tenantId: id,
      userId,
      action: 'DELETE_TENANT',
    });

    return { ...tenant, profileIncomplete: isTenantProfileIncomplete(tenant) };
  }

  /**
   * The date fields are validated as ISO strings (@IsDateString) but Prisma's DateTime
   * columns reject a bare date-only string ("premature end of input" — it needs a full
   * ISO datetime or a real Date object), so these must be converted before every write.
   * Mirrors the same conversion ContractsService already does for startDate/endDate.
   */
  private toDateFields(dto: { emiratesIdExpiry?: string; passportExpiry?: string; tradeLicenseExpiry?: string }) {
    return {
      ...(dto.emiratesIdExpiry && { emiratesIdExpiry: new Date(dto.emiratesIdExpiry) }),
      ...(dto.passportExpiry && { passportExpiry: new Date(dto.passportExpiry) }),
      ...(dto.tradeLicenseExpiry && { tradeLicenseExpiry: new Date(dto.tradeLicenseExpiry) }),
    };
  }

  /** Used by TenantDocumentsService to confirm a tenant exists and isn't soft-deleted. */
  async ensureTenantExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  private toListItem<
    T extends {
      id: string;
      tenantType: unknown;
      nameEn: string;
      nameAr: string | null;
      phone: string | null;
      email: string | null;
      status: unknown;
      createdAt: Date;
      _count?: { documents: number };
    },
  >(tenant: T) {
    return {
      id: tenant.id,
      tenantType: tenant.tenantType,
      nameEn: tenant.nameEn,
      nameAr: tenant.nameAr,
      phone: tenant.phone,
      email: tenant.email,
      status: tenant.status,
      documentCount: tenant._count?.documents ?? 0,
      createdAt: tenant.createdAt,
      profileIncomplete: isTenantProfileIncomplete(tenant as unknown as { tenantType?: string | null }),
    };
  }
}
