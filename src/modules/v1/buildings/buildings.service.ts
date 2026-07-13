import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CreateBuildingDto } from './dtos/create-building.dto';
import { UpdateBuildingDto } from './dtos/update-building.dto';
import { ListBuildingsQueryDto } from './dtos/list-buildings.query.dto';
import { PaginatedResult } from '../../../common/dtos/pagination.dto';

@Injectable()
export class BuildingsService {
  private readonly logger = new Logger(BuildingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListBuildingsQueryDto): Promise<PaginatedResult<object>> {
    const {
      page = 1,
      limit = 10,
      search,
      buildingType,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.BuildingWhereInput = {
      deletedAt: null,
      ...(buildingType && { buildingType }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.building.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.building.count({ where }),
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
    const building = await this.prisma.building.findFirst({
      where: { id, deletedAt: null },
    });

    if (!building) {
      throw new NotFoundException(`Building not found`);
    }

    return building;
  }

  async create(dto: CreateBuildingDto, userId: string) {
    const existing = await this.prisma.building.findUnique({
      where: { code: dto.code },
    });

    if (existing) {
      throw new ConflictException(`Building code '${dto.code}' already exists`);
    }

    const building = await this.prisma.building.create({
      data: {
        ...dto,
        createdById: userId,
      },
    });

    this.logger.log(`Building created`, {
      buildingId: building.id,
      userId,
      action: 'CREATE_BUILDING',
    });

    return building;
  }

  async update(id: string, dto: UpdateBuildingDto, userId: string) {
    await this.findOne(id);

    if (dto.code) {
      const duplicate = await this.prisma.building.findFirst({
        where: { code: dto.code, NOT: { id } },
      });
      if (duplicate) {
        throw new ConflictException(`Building code '${dto.code}' already exists`);
      }
    }

    const building = await this.prisma.building.update({
      where: { id },
      data: { ...dto, updatedById: userId },
    });

    this.logger.log(`Building updated`, {
      buildingId: id,
      userId,
      action: 'UPDATE_BUILDING',
    });

    return building;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);

    const building = await this.prisma.building.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });

    this.logger.log(`Building soft deleted`, {
      buildingId: id,
      userId,
      action: 'DELETE_BUILDING',
    });

    return building;
  }
}
