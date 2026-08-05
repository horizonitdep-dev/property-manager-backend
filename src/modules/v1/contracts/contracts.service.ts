import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { TenantsService } from '../tenants/tenants.service';
import { CreateContractDto } from './dtos/create-contract.dto';
import { UpdateContractDto } from './dtos/update-contract.dto';
import { RenewContractDto } from './dtos/renew-contract.dto';
import { TerminateContractDto } from './dtos/terminate-contract.dto';
import { ListContractsQueryDto } from './dtos/list-contracts.query.dto';
import { PaginatedResult } from '../../../common/dtos/pagination.dto';
import { ContractStatus } from '../../../common/enums/contract-status.enum';
import { PaymentFrequency } from '../../../common/enums/payment-frequency.enum';
import { PropertyStatus } from '../../../common/enums/property-status.enum';
import { computeEffectiveStatus, buildStatusFilter } from './helpers/contract-status.helper';
import { isNumberOfChequesMissing } from './validators/contract-dates.validator';

const contractSummaryInclude = {
  tenant: { select: { id: true, nameEn: true, nameAr: true, tenantType: true } },
  property: {
    select: {
      id: true,
      unitNumber: true,
      building: { select: { id: true, name: true, code: true } },
    },
  },
};

type ContractWithRelations = Prisma.ContractGetPayload<{ include: typeof contractSummaryInclude }>;

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly propertiesService: PropertiesService,
    private readonly tenantsService: TenantsService,
  ) {}

  async findAll(query: ListContractsQueryDto): Promise<PaginatedResult<object>> {
    const {
      page = 1,
      limit = 10,
      search,
      tenantId,
      propertyId,
      buildingId,
      status,
      startDateFrom,
      startDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.ContractWhereInput = {
      deletedAt: null,
      ...(tenantId && { tenantId }),
      ...(propertyId && { propertyId }),
      ...(buildingId && { property: { buildingId } }),
      ...(status && buildStatusFilter(status)),
      ...((startDateFrom || startDateTo) && {
        startDate: {
          ...(startDateFrom && { gte: new Date(startDateFrom) }),
          ...(startDateTo && { lte: new Date(startDateTo) }),
        },
      }),
      ...(search && {
        contractNumber: { contains: search, mode: 'insensitive' as const },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: contractSummaryInclude,
      }),
      this.prisma.contract.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: items.map((item) => this.toResponse(item)),
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
    const contract = await this.prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: contractSummaryInclude,
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    return this.toResponse(contract);
  }

  async findAllByProperty(propertyId: string, query: ListContractsQueryDto) {
    await this.propertiesService.findOne(propertyId);
    return this.findAll({ ...query, propertyId });
  }

  async findAllByTenant(tenantId: string, query: ListContractsQueryDto) {
    await this.tenantsService.ensureTenantExists(tenantId);
    return this.findAll({ ...query, tenantId });
  }

  /**
   * Accepts an optional transaction client so callers already inside their own
   * transaction (the import commit path, which must insert many contracts
   * atomically) can pass it straight through — this method skips opening its
   * own $transaction() in that case, since a nested $transaction() would just
   * run as an independent, separately-committing transaction and break the
   * caller's atomicity.
   */
  async create(dto: CreateContractDto, userId: string, client?: Prisma.TransactionClient) {
    await this.tenantsService.ensureTenantExists(dto.tenantId);
    await this.propertiesService.findOne(dto.propertyId);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    if (isNumberOfChequesMissing(dto)) {
      throw new BadRequestException('numberOfCheques is required when paymentFrequency is CHEQUES');
    }

    const status = dto.status ?? ContractStatus.DRAFT;

    const run = async (tx: Prisma.TransactionClient) => {
      if (status === ContractStatus.ACTIVE) {
        await this.assertNoOverlap(tx, dto.propertyId, startDate, endDate);
      }

      const contract = await tx.contract.create({
        data: {
          ...dto,
          startDate,
          endDate,
          status,
          createdById: userId,
        },
        include: contractSummaryInclude,
      });

      if (status === ContractStatus.ACTIVE) {
        await this.recomputePropertyOccupancy(tx, dto.propertyId, userId);
      }

      this.logger.log('Contract created', {
        contractId: contract.id,
        propertyId: dto.propertyId,
        tenantId: dto.tenantId,
        userId,
        action: 'CREATE_CONTRACT',
      });

      return this.toResponse(contract);
    };

    return client ? run(client) : this.prisma.$transaction(run);
  }

  async update(id: string, dto: UpdateContractDto, userId: string) {
    const current = await this.prisma.contract.findFirst({ where: { id, deletedAt: null } });
    if (!current) {
      throw new NotFoundException('Contract not found');
    }

    if (dto.tenantId) {
      await this.tenantsService.ensureTenantExists(dto.tenantId);
    }
    if (dto.propertyId) {
      await this.propertiesService.findOne(dto.propertyId);
    }

    const mergedStartDate = dto.startDate ? new Date(dto.startDate) : current.startDate;
    const mergedEndDate = dto.endDate ? new Date(dto.endDate) : current.endDate;
    if (mergedEndDate <= mergedStartDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const mergedPaymentFrequency = dto.paymentFrequency ?? current.paymentFrequency;
    const mergedNumberOfCheques = dto.numberOfCheques ?? current.numberOfCheques;
    if (isNumberOfChequesMissing({ paymentFrequency: mergedPaymentFrequency, numberOfCheques: mergedNumberOfCheques })) {
      throw new BadRequestException('numberOfCheques is required when paymentFrequency is CHEQUES');
    }

    const mergedStatus = dto.status ?? current.status;
    const mergedPropertyId = dto.propertyId ?? current.propertyId;

    return this.prisma.$transaction(async (tx) => {
      if (mergedStatus === ContractStatus.ACTIVE) {
        await this.assertNoOverlap(tx, mergedPropertyId, mergedStartDate, mergedEndDate, id);
      }

      const contract = await tx.contract.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.startDate && { startDate: mergedStartDate }),
          ...(dto.endDate && { endDate: mergedEndDate }),
          updatedById: userId,
        },
        include: contractSummaryInclude,
      });

      // Recompute both the old and new property in case propertyId itself changed.
      await this.recomputePropertyOccupancy(tx, current.propertyId, userId);
      if (mergedPropertyId !== current.propertyId) {
        await this.recomputePropertyOccupancy(tx, mergedPropertyId, userId);
      }

      this.logger.log('Contract updated', { contractId: id, userId, action: 'UPDATE_CONTRACT' });

      return this.toResponse(contract);
    });
  }

  async renew(id: string, dto: RenewContractDto, userId: string) {
    const source = await this.prisma.contract.findFirst({ where: { id, deletedAt: null } });
    if (!source) {
      throw new NotFoundException('Contract not found');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const paymentFrequency = dto.paymentFrequency ?? source.paymentFrequency;
    const numberOfCheques =
      paymentFrequency === PaymentFrequency.CHEQUES
        ? dto.numberOfCheques ?? source.numberOfCheques ?? undefined
        : undefined;

    if (isNumberOfChequesMissing({ paymentFrequency, numberOfCheques })) {
      throw new BadRequestException('numberOfCheques is required when paymentFrequency is CHEQUES');
    }

    const annualRent = dto.annualRent ?? Number(source.annualRent);
    const monthlyRent = dto.monthlyRent ?? Number(source.monthlyRent);
    const securityDeposit =
      dto.securityDeposit ?? (source.securityDeposit ? Number(source.securityDeposit) : undefined);
    const status = dto.status ?? ContractStatus.DRAFT;

    return this.prisma.$transaction(async (tx) => {
      if (status === ContractStatus.ACTIVE) {
        await this.assertNoOverlap(tx, source.propertyId, startDate, endDate);
      }

      const contract = await tx.contract.create({
        data: {
          contractNumber: dto.contractNumber,
          tenantId: source.tenantId,
          propertyId: source.propertyId,
          startDate,
          endDate,
          annualRent,
          monthlyRent,
          paymentFrequency,
          numberOfCheques,
          securityDeposit,
          status,
          renewedFromId: source.id,
          notes: dto.notes,
          createdById: userId,
        },
        include: contractSummaryInclude,
      });

      if (status === ContractStatus.ACTIVE) {
        await this.recomputePropertyOccupancy(tx, source.propertyId, userId);
      }

      this.logger.log('Contract renewed', {
        sourceContractId: id,
        newContractId: contract.id,
        userId,
        action: 'RENEW_CONTRACT',
      });

      return this.toResponse(contract);
    });
  }

  async terminate(id: string, dto: TerminateContractDto, userId: string) {
    const current = await this.prisma.contract.findFirst({ where: { id, deletedAt: null } });
    if (!current) {
      throw new NotFoundException('Contract not found');
    }

    const noteAddition =
      dto.terminationReason || dto.terminationDate
        ? `\n[Terminated${dto.terminationDate ? ` ${dto.terminationDate}` : ''}]${
            dto.terminationReason ? `: ${dto.terminationReason}` : ''
          }`
        : '';

    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.update({
        where: { id },
        data: {
          status: ContractStatus.TERMINATED,
          notes: `${current.notes ?? ''}${noteAddition}`.trim() || null,
          updatedById: userId,
        },
        include: contractSummaryInclude,
      });

      await this.recomputePropertyOccupancy(tx, current.propertyId, userId);

      this.logger.log('Contract terminated', { contractId: id, userId, action: 'TERMINATE_CONTRACT' });

      return this.toResponse(contract);
    });
  }

  async remove(id: string, userId: string) {
    const current = await this.prisma.contract.findFirst({ where: { id, deletedAt: null } });
    if (!current) {
      throw new NotFoundException('Contract not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: userId },
        include: contractSummaryInclude,
      });

      await this.recomputePropertyOccupancy(tx, current.propertyId, userId);

      this.logger.log('Contract soft deleted', { contractId: id, userId, action: 'DELETE_CONTRACT' });

      return this.toResponse(contract);
    });
  }

  /** Used by ContractDocumentsService to confirm a contract exists and isn't soft-deleted. */
  async ensureContractExists(contractId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    return contract;
  }

  /** Hard rule (§7.2): no two stored-ACTIVE, non-deleted contracts may overlap on the same property. */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    propertyId: string,
    startDate: Date,
    endDate: Date,
    excludeContractId?: string,
  ): Promise<void> {
    const conflict = await tx.contract.findFirst({
      where: {
        propertyId,
        status: ContractStatus.ACTIVE,
        deletedAt: null,
        ...(excludeContractId && { NOT: { id: excludeContractId } }),
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    if (conflict) {
      throw new ConflictException(
        `Property already has an active contract (${conflict.contractNumber}) overlapping these dates`,
      );
    }
  }

  /**
   * Side effect (§7.3): a property is OCCUPIED whenever it has any stored-ACTIVE,
   * non-deleted contract, VACANT otherwise — driven by contract writes, not a
   * scheduled sweep. Manual states (UNDER_MAINTENANCE/RESERVED) are left alone;
   * PropertiesService.setOccupancyStatus enforces that.
   */
  private async recomputePropertyOccupancy(
    tx: Prisma.TransactionClient,
    propertyId: string,
    userId: string,
  ): Promise<void> {
    const hasActive = await tx.contract.findFirst({
      where: { propertyId, status: ContractStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });

    await this.propertiesService.setOccupancyStatus(
      propertyId,
      hasActive ? PropertyStatus.OCCUPIED : PropertyStatus.VACANT,
      userId,
      tx,
    );
  }

  private toResponse(contract: ContractWithRelations) {
    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      startDate: contract.startDate,
      endDate: contract.endDate,
      annualRent: contract.annualRent,
      monthlyRent: contract.monthlyRent,
      paymentFrequency: contract.paymentFrequency,
      numberOfCheques: contract.numberOfCheques,
      securityDeposit: contract.securityDeposit,
      status: computeEffectiveStatus(contract.status as unknown as ContractStatus, contract.endDate),
      storedStatus: contract.status,
      renewedFromId: contract.renewedFromId,
      tenant: contract.tenant,
      property: contract.property,
      notes: contract.notes,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
  }
}
