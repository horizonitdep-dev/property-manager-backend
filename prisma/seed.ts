import { PrismaClient, UserRole, BuildingType, ConstructionStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

async function main() {
  const managerEmail = process.env.SEED_MANAGER_EMAIL ?? 'manager@horizonpm.com';
  const managerPassword = process.env.SEED_MANAGER_PASSWORD ?? 'ChangeMe123!';
  const secretaryEmail = process.env.SEED_SECRETARY_EMAIL ?? 'secretary@horizonpm.com';
  const secretaryPassword = process.env.SEED_SECRETARY_PASSWORD ?? 'ChangeMe123!';

  const [managerHash, secretaryHash] = await Promise.all([
    argon2.hash(managerPassword, ARGON2_OPTIONS),
    argon2.hash(secretaryPassword, ARGON2_OPTIONS),
  ]);

  const manager = await prisma.user.upsert({
    where: { email: managerEmail },
    update: {},
    create: {
      email: managerEmail,
      passwordHash: managerHash,
      fullName: 'Property Manager',
      role: UserRole.MANAGER,
      isActive: true,
    },
  });

  const secretary = await prisma.user.upsert({
    where: { email: secretaryEmail },
    update: {},
    create: {
      email: secretaryEmail,
      passwordHash: secretaryHash,
      fullName: 'Office Secretary',
      role: UserRole.SECRETARY,
      isActive: true,
    },
  });

  await prisma.building.upsert({
    where: { code: 'B001' },
    update: {},
    create: {
      name: 'Al Noor Tower',
      code: 'B001',
      address: 'Hamdan Street, Abu Dhabi',
      city: 'Abu Dhabi',
      buildingType: BuildingType.RESIDENTIAL,
      totalFloors: 12,
      yearBuilt: 2015,
      totalUnits: 96,
      constructionStatus: ConstructionStatus.COMPLETE,
      notes: 'Main residential tower with underground parking',
      createdById: manager.id,
    },
  });

  await prisma.building.upsert({
    where: { code: 'B002' },
    update: {},
    create: {
      name: 'Horizon Business Center',
      code: 'B002',
      address: 'Corniche Road, Abu Dhabi',
      city: 'Abu Dhabi',
      buildingType: BuildingType.COMMERCIAL,
      totalFloors: 8,
      yearBuilt: 2018,
      totalUnits: 32,
      constructionStatus: ConstructionStatus.UNDER_CONSTRUCTION,
      notes: 'Commercial offices, floors 1-8',
      createdById: manager.id,
    },
  });

  console.log('Seed completed:', {
    manager: manager.email,
    secretary: secretary.email,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
