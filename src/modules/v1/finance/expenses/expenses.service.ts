import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { PaginatedResult } from '../../../../common/dtos/pagination.dto';
import { ExpenseSourceType } from '../../../../common/enums/expense-source-type.enum';
import { toMoneyString } from '../shared/finance-money.util';
import { CreateExpenseDto } from './dtos/create-expense.dto';
import { UpdateExpenseDto } from './dtos/update-expense.dto';
import { ListExpensesQueryDto } from './dtos/list-expenses.query.dto';

const expenseInclude = {
  building: { select: { id: true, name: true, code: true } },
  property: { select: { id: true, unitNumber: true } },
  attachments: {
    where: { deletedAt: null },
    select: {
      id: true,
      type: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      uploadedAt: true,
      uploadedById: true,
    },
  },
};

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListExpensesQueryDto): Promise<PaginatedResult<object>> {
    const {
      page = 1,
      limit = 10,
      search,
      buildingId,
      propertyId,
      category,
      sourceType,
      method,
      incurredOnFrom,
      incurredOnTo,
      sortBy = 'incurredOn',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      ...(buildingId && { buildingId }),
      ...(propertyId && { propertyId }),
      ...(category && { category }),
      ...(sourceType && { sourceType }),
      ...(method && { method }),
      ...((incurredOnFrom || incurredOnTo) && {
        incurredOn: {
          ...(incurredOnFrom && { gte: new Date(incurredOnFrom) }),
          ...(incurredOnTo && { lte: new Date(incurredOnTo) }),
        },
      }),
      ...(search && {
        OR: [
          { vendorName: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
          { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: expenseInclude,
      }),
      this.prisma.expense.count({ where }),
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
    const expense = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: expenseInclude,
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    return this.toResponse(expense);
  }

  async findAllByBuilding(buildingId: string, query: ListExpensesQueryDto) {
    await this.ensureBuildingExists(buildingId);
    return this.findAll({ ...query, buildingId });
  }

  async findAllByProperty(propertyId: string, query: ListExpensesQueryDto) {
    await this.ensurePropertyExists(propertyId);
    return this.findAll({ ...query, propertyId });
  }

  async create(dto: CreateExpenseDto, userId: string) {
    await this.ensureBuildingExists(dto.buildingId);
    await this.assertPropertyInBuilding(dto.propertyId, dto.buildingId);

    const sourceType = dto.sourceType ?? ExpenseSourceType.GENERAL;

    // Belt-and-braces: the DTO's @ValidateIf already enforces this over HTTP, but
    // the extension point will be called service-to-service by Services later,
    // bypassing the ValidationPipe entirely.
    if (sourceType !== ExpenseSourceType.GENERAL && (!dto.sourceRefId || !dto.sourceRefType)) {
      throw new BadRequestException(
        `sourceRefId and sourceRefType are required when sourceType is ${sourceType}`,
      );
    }

    const expense = await this.prisma.expense.create({
      data: {
        buildingId: dto.buildingId,
        propertyId: dto.propertyId,
        category: dto.category,
        amount: new Prisma.Decimal(dto.amount),
        incurredOn: new Date(dto.incurredOn),
        vendorName: dto.vendorName,
        description: dto.description,
        method: dto.method,
        invoiceNumber: dto.invoiceNumber,
        sourceType,
        sourceRefId: dto.sourceRefId,
        sourceRefType: dto.sourceRefType,
        notes: dto.notes,
        createdById: userId,
      },
      include: expenseInclude,
    });

    this.logger.log('Expense created', {
      expenseId: expense.id,
      buildingId: dto.buildingId,
      propertyId: dto.propertyId ?? null,
      category: expense.category,
      sourceType,
      userId,
      action: 'CREATE_EXPENSE',
    });

    return this.toResponse(expense);
  }

  async update(id: string, dto: UpdateExpenseDto, userId: string) {
    const current = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!current) {
      throw new NotFoundException('Expense not found');
    }

    // An expense owned by another module is that module's record to maintain —
    // editing it here would let the two drift apart (spec §6).
    if (current.sourceType !== ExpenseSourceType.GENERAL) {
      throw new ConflictException(
        `This expense was created by ${current.sourceRefType ?? current.sourceType} and cannot be edited here. ` +
          'Update it through the module that owns it.',
      );
    }

    // Only re-check containment when one side of the pair actually moves. Checking
    // unconditionally would spend a query on every notes-only edit, and would fail
    // such an edit outright if the already-attached unit had since been soft-deleted.
    const buildingChanging = dto.buildingId !== undefined && dto.buildingId !== current.buildingId;
    const propertyChanging = dto.propertyId !== undefined && dto.propertyId !== current.propertyId;

    if (buildingChanging) {
      await this.ensureBuildingExists(dto.buildingId!);
    }

    if (buildingChanging || propertyChanging) {
      const targetBuildingId = dto.buildingId ?? current.buildingId;
      const targetPropertyId = dto.propertyId !== undefined ? dto.propertyId : current.propertyId;
      await this.assertPropertyInBuilding(targetPropertyId, targetBuildingId);
    }

    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.buildingId !== undefined && { buildingId: dto.buildingId }),
        ...(dto.propertyId !== undefined && { propertyId: dto.propertyId }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.amount !== undefined && { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.incurredOn !== undefined && { incurredOn: new Date(dto.incurredOn) }),
        ...(dto.vendorName !== undefined && { vendorName: dto.vendorName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.method !== undefined && { method: dto.method }),
        ...(dto.invoiceNumber !== undefined && { invoiceNumber: dto.invoiceNumber }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedById: userId,
      },
      include: expenseInclude,
    });

    this.logger.log('Expense updated', { expenseId: id, userId, action: 'UPDATE_EXPENSE' });

    return this.toResponse(expense);
  }

  async remove(id: string, userId: string) {
    const current = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!current) {
      throw new NotFoundException('Expense not found');
    }

    const expense = await this.prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
      include: expenseInclude,
    });

    this.logger.log('Expense soft deleted', { expenseId: id, userId, action: 'DELETE_EXPENSE' });

    return this.toResponse(expense);
  }

  /**
   * A unit-level expense must sit inside the building it is attributed to. Two
   * independent foreign keys cannot express that, so it is checked here — without
   * it, an expense could be attributed to building A while pointing at a unit in
   * building B and quietly corrupt both P&Ls (spec §5.3).
   */
  private async assertPropertyInBuilding(
    propertyId: string | null | undefined,
    buildingId: string,
  ): Promise<void> {
    if (!propertyId) return;

    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, buildingId: true, unitNumber: true },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    if (property.buildingId !== buildingId) {
      throw new BadRequestException(
        `Unit ${property.unitNumber} does not belong to the building this expense is attributed to`,
      );
    }
  }

  private async ensureBuildingExists(buildingId: string): Promise<void> {
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, deletedAt: null },
      select: { id: true },
    });

    if (!building) {
      throw new NotFoundException('Building not found');
    }
  }

  private async ensurePropertyExists(propertyId: string): Promise<void> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { id: true },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }
  }

  private toResponse(expense: ExpenseWithRelations) {
    const { amount, ...rest } = expense;

    return {
      ...rest,
      amount: toMoneyString(amount),
      isEditable: expense.sourceType === ExpenseSourceType.GENERAL,
    };
  }
}
