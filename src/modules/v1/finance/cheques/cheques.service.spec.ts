import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChequesService } from './cheques.service';
import { PrismaService } from '../../../../database/prisma.service';
import { ChequeStatus } from '../../../../common/enums/cheque-status.enum';
import { PaymentKind } from '../../../../common/enums/payment-kind.enum';
import { PaymentMethod } from '../../../../common/enums/payment-method.enum';

const heldCheque = {
  id: 'cheque-uuid',
  contractId: 'contract-uuid',
  chequeNumber: '000123',
  bankName: 'First Abu Dhabi Bank',
  amount: new Prisma.Decimal('7000.00'),
  chequeDate: new Date('2026-04-01'),
  status: ChequeStatus.HELD,
  receivedOn: new Date('2026-01-05'),
  depositedOn: null,
  clearedOn: null,
  bouncedOn: null,
  bounceReason: null,
  replacedByChequeId: null,
  notes: null,
  createdById: 'user-uuid',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

type ChequeLinkRow = {
  id: string;
  chequeNumber: string;
  bankName: string;
  status: ChequeStatus;
  amount: Prisma.Decimal;
};

type LinkedPaymentRow = {
  id: string;
  amount: Prisma.Decimal;
  paidOn: Date;
  deletedAt: Date | null;
};

/**
 * What findOne() returns after an action — the service re-reads to build the
 * response. Annotated so the nullable relations stay widened; without it the null
 * literals narrow to type `null` and overrides cannot supply a row.
 */
const chequeWithRelations: typeof heldCheque & {
  contract: Record<string, unknown>;
  replacedBy: ChequeLinkRow | null;
  replaces: ChequeLinkRow | null;
  payment: LinkedPaymentRow | null;
  attachments: unknown[];
} = {
  ...heldCheque,
  contract: {
    id: 'contract-uuid',
    contractNumber: '202303980216',
    tenant: { id: 'tenant-uuid', nameEn: 'Ahmed Al Mansoori', nameAr: null, tenantType: 'INDIVIDUAL' },
    property: {
      id: 'property-uuid',
      unitNumber: '102',
      building: { id: 'building-uuid', name: 'R6-MZW16', code: 'R6-MZW16' },
    },
  },
  replacedBy: null,
  replaces: null,
  payment: null,
  attachments: [],
};

const baseCreateDto = {
  contractId: 'contract-uuid',
  chequeNumber: '000123',
  bankName: 'First Abu Dhabi Bank',
  amount: 7000,
  chequeDate: '2026-04-01',
  receivedOn: '2026-01-05',
};

describe('ChequesService', () => {
  let service: ChequesService;
  let prisma: {
    cheque: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    payment: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    contract: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  /** The client handed to the $transaction callback. */
  let tx: { cheque: { create: jest.Mock; update: jest.Mock }; payment: typeof prisma.payment };

  beforeEach(async () => {
    prisma = {
      cheque: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      contract: { findFirst: jest.fn().mockResolvedValue({ id: 'contract-uuid' }) },
      $transaction: jest.fn(),
    };

    tx = {
      cheque: { create: jest.fn().mockResolvedValue({ id: 'new-cheque-uuid', status: ChequeStatus.HELD }), update: jest.fn() },
      payment: prisma.payment,
    };
    // Run the callback with our fake tx client so we can assert what happened inside.
    prisma.$transaction.mockImplementation((cb: (c: typeof tx) => unknown) => cb(tx));

    const module: TestingModule = await Test.createTestingModule({
      providers: [ChequesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ChequesService);
  });

  /** Points findOne() at a cheque in the given state. */
  function readsBackAs(overrides: Partial<typeof chequeWithRelations> = {}) {
    prisma.cheque.findFirst.mockResolvedValue({ ...chequeWithRelations, ...overrides });
  }

  describe('create', () => {
    it('always starts a cheque HELD', async () => {
      prisma.cheque.create.mockResolvedValue({ id: 'cheque-uuid', status: ChequeStatus.HELD });
      readsBackAs();

      await service.create(baseCreateDto, 'user-uuid');

      expect(prisma.cheque.create.mock.calls[0][0].data.status).toBe(ChequeStatus.HELD);
    });

    it('stores the amount as a Decimal', async () => {
      prisma.cheque.create.mockResolvedValue({ id: 'cheque-uuid', status: ChequeStatus.HELD });
      readsBackAs();

      await service.create(baseCreateDto, 'user-uuid');

      expect(prisma.cheque.create.mock.calls[0][0].data.amount).toBeInstanceOf(Prisma.Decimal);
    });

    it('404s when the contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(service.create(baseCreateDto, 'user-uuid')).rejects.toThrow(NotFoundException);
      expect(prisma.cheque.create).not.toHaveBeenCalled();
    });
  });

  describe('deposit', () => {
    it('moves HELD → DEPOSITED and records the date', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(heldCheque);
      readsBackAs({ status: ChequeStatus.DEPOSITED });

      await service.deposit('cheque-uuid', { depositedOn: '2026-04-02' }, 'user-uuid');

      const { data } = prisma.cheque.update.mock.calls[0][0];
      expect(data.status).toBe(ChequeStatus.DEPOSITED);
      expect(data.depositedOn).toEqual(new Date('2026-04-02'));
    });

    it('409s on a bounced cheque', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce({ ...heldCheque, status: ChequeStatus.BOUNCED });

      await expect(
        service.deposit('cheque-uuid', { depositedOn: '2026-04-02' }, 'user-uuid'),
      ).rejects.toThrow('Cannot deposit a bounced cheque. Only a held cheque can be deposited.');
      expect(prisma.cheque.update).not.toHaveBeenCalled();
    });

    it('404s for a missing cheque', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.deposit('cheque-uuid', { depositedOn: '2026-04-02' }, 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('clear', () => {
    const depositedCheque = { ...heldCheque, status: ChequeStatus.DEPOSITED, depositedOn: new Date('2026-04-02') };

    it('moves DEPOSITED → CLEARED and creates the Payment in the same transaction', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(depositedCheque);
      readsBackAs({ status: ChequeStatus.CLEARED });

      await service.clear('cheque-uuid', { clearedOn: '2026-04-04' }, 'user-uuid');

      // One transaction covering both writes — never two independent updates.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.cheque.update.mock.calls[0][0].data.status).toBe(ChequeStatus.CLEARED);
      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    });

    it('copies the payment amount and date from the cheque, not from the caller', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(depositedCheque);
      readsBackAs({ status: ChequeStatus.CLEARED });

      await service.clear('cheque-uuid', { clearedOn: '2026-04-04' }, 'user-uuid');

      const { data } = prisma.payment.create.mock.calls[0][0];
      expect(data.amount).toBe(depositedCheque.amount);
      expect(data.paidOn).toEqual(new Date('2026-04-04'));
      expect(data.method).toBe(PaymentMethod.CHEQUE);
      expect(data.chequeId).toBe('cheque-uuid');
      expect(data.contractId).toBe('contract-uuid');
    });

    it('defaults the payment kind to RENT', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(depositedCheque);
      readsBackAs({ status: ChequeStatus.CLEARED });

      await service.clear('cheque-uuid', { clearedOn: '2026-04-04' }, 'user-uuid');

      expect(prisma.payment.create.mock.calls[0][0].data.kind).toBe(PaymentKind.RENT);
    });

    it('honours a kind override, e.g. for a deposit cheque', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(depositedCheque);
      readsBackAs({ status: ChequeStatus.CLEARED });

      await service.clear(
        'cheque-uuid',
        { clearedOn: '2026-04-04', kind: PaymentKind.SECURITY_DEPOSIT },
        'user-uuid',
      );

      expect(prisma.payment.create.mock.calls[0][0].data.kind).toBe(PaymentKind.SECURITY_DEPOSIT);
    });

    it('409s when the cheque was never deposited', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(heldCheque);

      await expect(service.clear('cheque-uuid', { clearedOn: '2026-04-04' }, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('409s when clearing an already bounced cheque', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce({ ...heldCheque, status: ChequeStatus.BOUNCED });

      await expect(service.clear('cheque-uuid', { clearedOn: '2026-04-04' }, 'user-uuid')).rejects.toThrow(
        /Cannot clear a bounced cheque/,
      );
    });

    it('revives the voided payment instead of inserting a second one after a bounce cycle', async () => {
      // payments.cheque_id is UNIQUE, so a soft-deleted payment from an earlier
      // clear→bounce would collide if we blindly created another.
      prisma.cheque.findFirst.mockResolvedValueOnce(depositedCheque);
      prisma.payment.findUnique.mockResolvedValue({ id: 'old-payment-uuid' });
      readsBackAs({ status: ChequeStatus.CLEARED });

      await service.clear('cheque-uuid', { clearedOn: '2026-05-01' }, 'user-uuid');

      expect(prisma.payment.create).not.toHaveBeenCalled();
      const { where, data } = prisma.payment.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'old-payment-uuid' });
      expect(data.deletedAt).toBeNull();
      expect(data.paidOn).toEqual(new Date('2026-05-01'));
    });
  });

  describe('bounce', () => {
    const depositedCheque = { ...heldCheque, status: ChequeStatus.DEPOSITED };
    const clearedCheque = { ...heldCheque, status: ChequeStatus.CLEARED, clearedOn: new Date('2026-04-04') };

    it('moves DEPOSITED → BOUNCED with the reason', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(depositedCheque);
      readsBackAs({ status: ChequeStatus.BOUNCED });

      await service.bounce(
        'cheque-uuid',
        { bouncedOn: '2026-04-05', bounceReason: 'Insufficient funds' },
        'user-uuid',
      );

      const { data } = tx.cheque.update.mock.calls[0][0];
      expect(data.status).toBe(ChequeStatus.BOUNCED);
      expect(data.bounceReason).toBe('Insufficient funds');
    });

    it('voids the linked Payment when a CLEARED cheque bounces', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(clearedCheque);
      prisma.payment.findFirst.mockResolvedValue({ id: 'payment-uuid' });
      readsBackAs({ status: ChequeStatus.BOUNCED });

      await service.bounce(
        'cheque-uuid',
        { bouncedOn: '2026-04-10', bounceReason: 'Returned unpaid' },
        'user-uuid',
      );

      // Same transaction as the status change — bounced money must never remain counted.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.payment.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'payment-uuid' });
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('soft-deletes rather than removing the payment, keeping the reversal auditable', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(clearedCheque);
      prisma.payment.findFirst.mockResolvedValue({ id: 'payment-uuid' });
      readsBackAs({ status: ChequeStatus.BOUNCED });

      await service.bounce('cheque-uuid', { bouncedOn: '2026-04-10', bounceReason: 'x' }, 'user-uuid');

      expect(prisma.payment.update).toHaveBeenCalled();
    });

    it('409s when a DEPOSITED cheque somehow already has a payment', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(depositedCheque);
      prisma.payment.findFirst.mockResolvedValue({ id: 'payment-uuid' });

      await expect(
        service.bounce('cheque-uuid', { bouncedOn: '2026-04-05', bounceReason: 'x' }, 'user-uuid'),
      ).rejects.toThrow(/already has a payment recorded/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('409s when bouncing a HELD cheque', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(heldCheque);

      await expect(
        service.bounce('cheque-uuid', { bouncedOn: '2026-04-05', bounceReason: 'x' }, 'user-uuid'),
      ).rejects.toThrow(/Only a deposited or cleared cheque can be bounced/);
    });
  });

  describe('replace', () => {
    const bouncedCheque = { ...heldCheque, status: ChequeStatus.BOUNCED };

    const replacementDto = {
      chequeNumber: '000456',
      bankName: 'First Abu Dhabi Bank',
      amount: 7000,
      chequeDate: '2026-05-01',
      receivedOn: '2026-04-11',
    };

    it('creates the replacement and marks the original REPLACED in one transaction', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(bouncedCheque);
      readsBackAs({ id: 'new-cheque-uuid' });

      await service.replace('cheque-uuid', replacementDto, 'user-uuid');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.cheque.create).toHaveBeenCalledTimes(1);
      const { data } = tx.cheque.update.mock.calls[0][0];
      expect(data.status).toBe(ChequeStatus.REPLACED);
      expect(data.replacedByChequeId).toBe('new-cheque-uuid');
    });

    it('gives the replacement the original contract and HELD status', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(bouncedCheque);
      readsBackAs({ id: 'new-cheque-uuid' });

      await service.replace('cheque-uuid', replacementDto, 'user-uuid');

      const { data } = tx.cheque.create.mock.calls[0][0];
      expect(data.contractId).toBe('contract-uuid');
      expect(data.status).toBe(ChequeStatus.HELD);
      expect(data.chequeNumber).toBe('000456');
    });

    it('allows replacing a HELD cheque by mutual agreement', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(heldCheque);
      readsBackAs({ id: 'new-cheque-uuid' });

      await expect(service.replace('cheque-uuid', replacementDto, 'user-uuid')).resolves.toBeDefined();
    });

    it('refuses to replace the same cheque twice', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce({
        ...bouncedCheque,
        replacedByChequeId: 'already-replaced-uuid',
      });

      await expect(service.replace('cheque-uuid', replacementDto, 'user-uuid')).rejects.toThrow(
        'This cheque has already been replaced',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('409s when replacing a cleared cheque', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce({ ...heldCheque, status: ChequeStatus.CLEARED });

      await expect(service.replace('cheque-uuid', replacementDto, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
    });

    it('turns a duplicate cheque number into a readable 409', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(bouncedCheque);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );

      await expect(service.replace('cheque-uuid', replacementDto, 'user-uuid')).rejects.toThrow(
        /Cheque 000456 from First Abu Dhabi Bank already exists/,
      );
    });
  });

  describe('cancel', () => {
    it('moves HELD → CANCELLED', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(heldCheque);
      readsBackAs({ status: ChequeStatus.CANCELLED });

      await service.cancel('cheque-uuid', {}, 'user-uuid');

      expect(prisma.cheque.update.mock.calls[0][0].data.status).toBe(ChequeStatus.CANCELLED);
    });

    it('409s once the cheque has been deposited', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce({ ...heldCheque, status: ChequeStatus.DEPOSITED });

      await expect(service.cancel('cheque-uuid', {}, 'user-uuid')).rejects.toThrow(
        /Cannot cancel a deposited cheque/,
      );
    });
  });

  describe('update', () => {
    it('edits metadata while HELD', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(heldCheque);
      readsBackAs();

      await service.update('cheque-uuid', { bankName: 'Emirates NBD' }, 'user-uuid');

      expect(prisma.cheque.update.mock.calls[0][0].data.bankName).toBe('Emirates NBD');
    });

    it('409s once deposited, naming the blocking status', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce({ ...heldCheque, status: ChequeStatus.DEPOSITED });

      await expect(service.update('cheque-uuid', { bankName: 'x' }, 'user-uuid')).rejects.toThrow(
        'Cannot edit a deposited cheque. Only a held cheque can be edited.',
      );
    });

    it('turns a duplicate number into a readable 409', async () => {
      prisma.cheque.findFirst.mockResolvedValueOnce(heldCheque);
      prisma.cheque.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }),
      );

      await expect(
        service.update('cheque-uuid', { chequeNumber: '000999' }, 'user-uuid'),
      ).rejects.toThrow(/Cheque 000999 from First Abu Dhabi Bank already exists/);
    });
  });

  describe('remove', () => {
    it.each([ChequeStatus.HELD, ChequeStatus.CANCELLED])('soft deletes a %s cheque', async (status) => {
      prisma.cheque.findFirst.mockResolvedValueOnce({ ...heldCheque, status });
      prisma.cheque.update.mockResolvedValue({ ...chequeWithRelations, deletedAt: new Date() });

      await service.remove('cheque-uuid', 'user-uuid');

      expect(prisma.cheque.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    });

    it.each([ChequeStatus.DEPOSITED, ChequeStatus.CLEARED, ChequeStatus.BOUNCED, ChequeStatus.REPLACED])(
      'refuses to delete a %s cheque',
      async (status) => {
        prisma.cheque.findFirst.mockResolvedValueOnce({ ...heldCheque, status });

        await expect(service.remove('cheque-uuid', 'user-uuid')).rejects.toThrow(ConflictException);
        expect(prisma.cheque.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('response shape', () => {
    it('serialises amounts as strings', async () => {
      readsBackAs();

      const result = await service.findOne('cheque-uuid');

      expect(result.amount).toBe('7000.00');
    });

    it('exposes a live linked payment', async () => {
      readsBackAs({
        status: ChequeStatus.CLEARED,
        payment: {
          id: 'payment-uuid',
          amount: new Prisma.Decimal('7000.00'),
          paidOn: new Date('2026-04-04'),
          deletedAt: null,
        },
      });

      const result = await service.findOne('cheque-uuid');

      expect(result.payment).toEqual({
        id: 'payment-uuid',
        amount: '7000.00',
        paidOn: new Date('2026-04-04'),
      });
    });

    it('hides a voided payment after a bounce, so the cheque does not look paid', async () => {
      readsBackAs({
        status: ChequeStatus.BOUNCED,
        payment: {
          id: 'payment-uuid',
          amount: new Prisma.Decimal('7000.00'),
          paidOn: new Date('2026-04-04'),
          deletedAt: new Date('2026-04-10'),
        },
      });

      const result = await service.findOne('cheque-uuid');

      expect(result.payment).toBeNull();
    });

    it('exposes both ends of the replacement chain with string amounts', async () => {
      readsBackAs({
        status: ChequeStatus.REPLACED,
        replacedBy: {
          id: 'new-cheque-uuid',
          chequeNumber: '000456',
          bankName: 'First Abu Dhabi Bank',
          status: ChequeStatus.HELD,
          amount: new Prisma.Decimal('7000.00'),
        },
      });

      const result = await service.findOne('cheque-uuid');

      expect(result.replacedBy).toMatchObject({ chequeNumber: '000456', amount: '7000.00' });
      expect(result.replaces).toBeNull();
    });

    it('404s for a missing cheque', async () => {
      prisma.cheque.findFirst.mockResolvedValue(null);

      await expect(service.findOne('cheque-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll filters', () => {
    beforeEach(() => {
      prisma.cheque.findMany.mockResolvedValue([chequeWithRelations]);
      prisma.cheque.count.mockResolvedValue(1);
    });

    function whereOf() {
      return prisma.cheque.findMany.mock.calls[0][0].where;
    }

    it('excludes soft-deleted cheques and contracts by default', async () => {
      await service.findAll({});

      expect(whereOf().deletedAt).toBeNull();
      expect(whereOf().contract).toEqual({ deletedAt: null });
    });

    it('filters by status', async () => {
      await service.findAll({ status: ChequeStatus.HELD });

      expect(whereOf().status).toBe(ChequeStatus.HELD);
    });

    it('resolves buildingId through contract → property', async () => {
      await service.findAll({ buildingId: 'building-uuid' });

      expect(whereOf().contract).toEqual({ deletedAt: null, property: { buildingId: 'building-uuid' } });
    });

    it('filters an inclusive chequeDate range', async () => {
      await service.findAll({ chequeDateFrom: '2026-01-01', chequeDateTo: '2026-12-31' });

      expect(whereOf().chequeDate).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-12-31'),
      });
    });

    it('sorts by chequeDate ascending by default — soonest due first', async () => {
      await service.findAll({});

      expect(prisma.cheque.findMany.mock.calls[0][0].orderBy).toEqual({ chequeDate: 'asc' });
    });
  });

  describe('findAllByContract', () => {
    it('404s when the contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(service.findAllByContract('contract-uuid', {})).rejects.toThrow(NotFoundException);
    });
  });
});
