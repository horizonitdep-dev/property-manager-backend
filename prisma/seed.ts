import {
  PrismaClient,
  UserRole,
  BuildingType,
  ConstructionStatus,
  UnitType,
  PropertyStatus,
  TenantType,
  TenantStatus,
  ContractStatus as PrismaContractStatus,
  PaymentFrequency as PrismaPaymentFrequency,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ContractsService } from '../src/modules/v1/contracts/contracts.service';
// The app's own enums (not @prisma/client's) — these are what the DTOs consumed
// by ContractsService.create/renew expect.
import { ContractStatus } from '../src/common/enums/contract-status.enum';
import { PaymentFrequency } from '../src/common/enums/payment-frequency.enum';

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
      // Starts VACANT — the sample ACTIVE contract below flips it to OCCUPIED
      // through the real ContractsService code path, not by hand here.
      status: PropertyStatus.VACANT,
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

  const propertiesByUnit: Record<string, Awaited<ReturnType<typeof prisma.property.upsert>>> = {};
  for (const property of properties) {
    propertiesByUnit[property.unitNumber] = await prisma.property.upsert({
      where: { buildingId_unitNumber: { buildingId: building1.id, unitNumber: property.unitNumber } },
      update: {},
      create: {
        ...property,
        buildingId: building1.id,
        createdById: manager.id,
      },
    });
  }

  const tenants = [
    {
      tenantType: TenantType.INDIVIDUAL,
      nameEn: 'Ahmed Al Mansoori',
      nameAr: 'أحمد المنصوري',
      phone: '+971501234567',
      email: 'ahmed.almansoori@example.com',
      nationality: 'UAE',
      emiratesIdNumber: '784-1990-1234567-1',
      emiratesIdExpiry: new Date('2027-01-31'),
      passportNumber: 'P1234567',
      passportExpiry: new Date('2029-06-30'),
    },
    {
      tenantType: TenantType.INDIVIDUAL,
      nameEn: 'Fatima Hassan',
      nameAr: 'فاطمة حسن',
      phone: '+971502345678',
      email: 'fatima.hassan@example.com',
      nationality: 'Egypt',
      emiratesIdNumber: '784-1988-7654321-2',
      emiratesIdExpiry: new Date('2026-11-30'),
      passportNumber: 'P7654321',
      passportExpiry: new Date('2028-03-15'),
    },
    {
      tenantType: TenantType.COMPANY,
      nameEn: 'Al Falah Trading LLC',
      nameAr: 'شركة الفلاح للتجارة ذ.م.م',
      phone: '+97126543210',
      email: 'info@alfalahtrading.example.com',
      tradeLicenseNumber: 'CN-1234567',
      tradeLicenseExpiry: new Date('2026-12-31'),
      authorizedPersonNameEn: 'Khalid Al Suwaidi',
      authorizedPersonNameAr: 'خالد السويدي',
      authorizedPersonOccupation: 'General Manager',
      authorizedPersonPhone: '+971503456789',
    },
  ];

  // Tenant has no natural unique key to `upsert` against, so idempotency is
  // done manually: skip creation if a tenant with this nameEn already exists.
  const tenantsByName: Record<string, Awaited<ReturnType<typeof prisma.tenant.create>>> = {};
  for (const tenant of tenants) {
    const existing = await prisma.tenant.findFirst({ where: { nameEn: tenant.nameEn } });
    tenantsByName[tenant.nameEn] =
      existing ??
      (await prisma.tenant.create({
        data: {
          ...tenant,
          status: TenantStatus.ACTIVE,
          createdById: manager.id,
        },
      }));
  }

  const contractsCreated = await seedContracts(manager.id, propertiesByUnit, tenantsByName);

  console.log('Seed completed:', {
    manager: manager.email,
    secretary: secretary.email,
    properties: properties.length,
    tenants: tenants.length,
    contractsCreated,
  });
}

/**
 * Contracts have real business logic (overlap rule, property-occupancy side
 * effect) living in ContractsService, not just the Prisma model — so unlike
 * the other seed data above, these go through a real Nest application context
 * to reuse that exact code path (§9: "ensure the sample active contracts flip
 * their linked properties to OCCUPIED via the same code path, not by hand").
 * contractNumber has no unique DB constraint, so idempotency is manual, same
 * as the tenant dedup above: skip creation if the number already exists.
 */
async function seedContracts(
  managerId: string,
  propertiesByUnit: Record<string, { id: string }>,
  tenantsByName: Record<string, { id: string }>,
): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let created = 0;

  try {
    const contractsService = app.get(ContractsService);

    // A prior (now-ended) lease on unit 102, so the current one below can
    // demonstrate the renewal chain via renewedFromId.
    const priorContractNumber = '2024-B001-102';
    const priorExisting = await prisma.contract.findFirst({
      where: { contractNumber: priorContractNumber },
    });
    const priorContract =
      priorExisting ??
      (await prisma.contract.create({
        data: {
          contractNumber: priorContractNumber,
          tenantId: tenantsByName['Ahmed Al Mansoori'].id,
          propertyId: propertiesByUnit['102'].id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          annualRent: 27000,
          monthlyRent: 2250,
          paymentFrequency: PrismaPaymentFrequency.MONTHLY,
          status: PrismaContractStatus.TERMINATED,
          createdById: managerId,
        },
      }));

    // Current ACTIVE monthly contract on unit 102, renewed from the one above.
    // Deliberately non-dividing rent (28,000/yr vs 2,330/mo = 27,960/yr),
    // mirroring the real R6 register.
    const renewalContractNumber = '2025-B001-102';
    const renewalExists = await prisma.contract.findFirst({
      where: { contractNumber: renewalContractNumber },
    });
    if (!renewalExists) {
      await contractsService.renew(
        priorContract.id,
        {
          contractNumber: renewalContractNumber,
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          annualRent: 28000,
          monthlyRent: 2330,
          status: ContractStatus.ACTIVE,
        },
        managerId,
      );
      created += 1;
    }

    // ACTIVE single-payment contract ("Police flat" style arrangement from R6's notes column).
    const singlePaymentNumber = '2025-B001-201';
    const singlePaymentExists = await prisma.contract.findFirst({
      where: { contractNumber: singlePaymentNumber },
    });
    if (!singlePaymentExists) {
      await contractsService.create(
        {
          contractNumber: singlePaymentNumber,
          tenantId: tenantsByName['Fatima Hassan'].id,
          propertyId: propertiesByUnit['201'].id,
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          annualRent: 33600,
          monthlyRent: 2800,
          paymentFrequency: PaymentFrequency.SINGLE_PAYMENT,
          status: ContractStatus.ACTIVE,
          notes: 'Police flat — paid as a single annual payment',
        },
        managerId,
      );
      created += 1;
    }

    // DRAFT contract — not yet active, so Office 5 correctly stays VACANT.
    const draftContractNumber = '2026-B001-OFF5';
    const draftExists = await prisma.contract.findFirst({ where: { contractNumber: draftContractNumber } });
    if (!draftExists) {
      await contractsService.create(
        {
          contractNumber: draftContractNumber,
          tenantId: tenantsByName['Al Falah Trading LLC'].id,
          propertyId: propertiesByUnit['Office 5'].id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          annualRent: 36000,
          monthlyRent: 3000,
          paymentFrequency: PaymentFrequency.MONTHLY,
          status: ContractStatus.DRAFT,
        },
        managerId,
      );
      created += 1;
    }

    return created;
  } finally {
    await app.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
