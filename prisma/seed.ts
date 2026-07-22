import {
  PrismaClient,
  UserRole,
  BuildingType,
  ConstructionStatus,
  UnitType,
  PropertyStatus,
} from '@prisma/client';
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

  const building1 = await prisma.building.upsert({
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

  const properties = [
    {
      unitNumber: '101',
      floor: 1,
      unitType: UnitType.APARTMENT,
      bedrooms: 1,
      bathrooms: 1,
      sizeSqm: 65,
      monthlyRent: 2000,
      status: PropertyStatus.OCCUPIED,
    },
    {
      unitNumber: '102',
      floor: 1,
      unitType: UnitType.APARTMENT,
      bedrooms: 2,
      bathrooms: 2,
      sizeSqm: 95,
      monthlyRent: 2500,
      status: PropertyStatus.OCCUPIED,
    },
    {
      unitNumber: '201',
      floor: 2,
      unitType: UnitType.APARTMENT,
      bedrooms: 2,
      bathrooms: 2,
      sizeSqm: 100,
      monthlyRent: 2800,
      status: PropertyStatus.VACANT,
    },
    {
      unitNumber: 'Shop 1',
      floor: 0,
      unitType: UnitType.SHOP,
      bedrooms: null,
      bathrooms: 1,
      sizeSqm: 40,
      monthlyRent: 3500,
      status: PropertyStatus.OCCUPIED,
    },
    {
      unitNumber: 'Office 5',
      floor: 5,
      unitType: UnitType.OFFICE,
      bedrooms: null,
      bathrooms: 1,
      sizeSqm: 55,
      monthlyRent: 3000,
      status: PropertyStatus.VACANT,
    },
  ];

  for (const property of properties) {
    await prisma.property.upsert({
      where: { buildingId_unitNumber: { buildingId: building1.id, unitNumber: property.unitNumber } },
      update: {},
      create: {
        ...property,
        buildingId: building1.id,
        createdById: manager.id,
      },
    });
  }

  console.log('Seed completed:', {
    manager: manager.email,
    secretary: secretary.email,
    properties: properties.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
