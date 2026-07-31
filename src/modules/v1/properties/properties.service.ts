import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CreatePropertyDto } from './dtos/create-property.dto';
import { UpdatePropertyDto } from './dtos/update-property.dto';
import { ListPropertiesQueryDto } from './dtos/list-properties.query.dto';
import { PaginatedResult } from '../../../common/dtos/pagination.dto';

const buildingSummaryInclude = {
  building: { select: { id: true, name: true, code: true } },
};

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListPropertiesQueryDto): Promise<PaginatedResult<object>> {
    const {
      page = 1,
      limit = 10,
      search,
      buildingId,
      unitType,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.PropertyWhereInput = {
      deletedAt: null,
      ...(buildingId && { buildingId }),
      ...(unitType && { unitType }),
      ...(status && { status }),
      ...(search && {
        unitNumber: { contains: search, mode: 'insensitive' },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: buildingSummaryInclude,
      }),
      this.prisma.property.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items,
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
    const property = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: buildingSummaryInclude,
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    return property;
  }

  async findAllByBuilding(buildingId: string, query: ListPropertiesQueryDto) {
    await this.ensureBuildingExists(buildingId);
    return this.findAll({ ...query, buildingId });
  }

  async create(dto: CreatePropertyDto, userId: string) {
    await this.ensureBuildingExists(dto.buildingId);

    const existing = await this.prisma.property.findFirst({
      where: { buildingId: dto.buildingId, unitNumber: dto.unitNumber, deletedAt: null },
    });

    if (existing) {
      throw new ConflictException(`Unit '${dto.unitNumber}' already exists in this building`);
    }

    const property = await this.prisma.property.create({
      data: {
        ...dto,
        createdById: userId,
      },
      include: buildingSummaryInclude,
    });

    this.logger.log('Property created', {
      propertyId: property.id,
      userId,
      action: 'CREATE_PROPERTY',
    });

    return property;
  }

  async update(id: string, dto: UpdatePropertyDto, userId: string) {
    const current = await this.findOne(id);

    if (dto.buildingId) {
      await this.ensureBuildingExists(dto.buildingId);
    }

    if (dto.unitNumber) {
      const targetBuildingId = dto.buildingId ?? current.buildingId;
      const duplicate = await this.prisma.property.findFirst({
        where: {
          buildingId: targetBuildingId,
          unitNumber: dto.unitNumber,
          deletedAt: null,
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Unit '${dto.unitNumber}' already exists in this building`);
      }
    }

    const property = await this.prisma.property.update({
      where: { id },
      data: { ...dto, updatedById: userId },
      include: buildingSummaryInclude,
    });

    this.logger.log('Property updated', {
      propertyId: id,
      userId,
      action: 'UPDATE_PROPERTY',
    });

    return property;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);

    const property = await this.prisma.property.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
      include: buildingSummaryInclude,
    });

    this.logger.log('Property soft deleted', {
      propertyId: id,
      userId,
      action: 'DELETE_PROPERTY',
    });

    return property;
  }

  private async ensureBuildingExists(buildingId: string) {
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, deletedAt: null },
    });

    if (!building) {
      throw new NotFoundException('Building not found');
    }
  }
}
