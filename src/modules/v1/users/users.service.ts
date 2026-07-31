import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserDto } from './dtos/update-user.dto';

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.sanitizeUser(u));
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User not found`);
    }
    return this.sanitizeUser(user);
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        role: dto.role,
      },
    });

    this.logger.log(`User created`, { userId: user.id, action: 'CREATE_USER' });
    return this.sanitizeUser(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: dto,
    });
    return this.sanitizeUser(user);
  }

  async remove(id: string) {
    await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
    this.logger.log(`User deactivated`, { userId: id, action: 'DEACTIVATE_USER' });
    return this.sanitizeUser(user);
  }

  private sanitizeUser(user: User) {
    const { passwordHash, refreshTokenHash, ...safe } = user;
    void passwordHash;
    void refreshTokenHash;
    return safe;
  }
}
