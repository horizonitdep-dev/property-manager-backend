import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { PaginatedResult } from '../../../../common/dtos/pagination.dto';
import { ChequeStatus } from '../../../../common/enums/cheque-status.enum';
import { PaymentKind } from '../../../../common/enums/payment-kind.enum';
import { PaymentMethod } from '../../../../common/enums/payment-method.enum';
import { toMoneyString } from '../shared/finance-money.util';
import { assertTransition } from './helpers/cheque-transitions.helper';
import { CreateChequeDto } from './dtos/create-cheque.dto';
import { UpdateChequeDto } from './dtos/update-cheque.dto';
import { ListChequesQueryDto } from './dtos/list-cheques.query.dto';
import {
  BounceChequeDto,
  CancelChequeDto,
  ClearChequeDto,
  DepositChequeDto,
  ReplaceChequeDto,
} from './dtos/cheque-actions.dto';

const chequeLinkSelect = {
  id: true,
  chequeNumber: true,
  bankName: true,
  status: true,
  amount: true,
};

const chequeInclude = {
  contract: {
    select: {
      id: true,
      contractNumber: true,
      tenant: { select: { id: true, nameEn: true, nameAr: true, tenantType: true } },
      property: {
        select: {
          id: true,
          unitNumber: true,
          building: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  replacedBy: { select: chequeLinkSelect },
  replaces: { select: chequeLinkSelect },
  // The payment is filtered to live rows: bouncing a cleared cheque voids its
  // payment, and a voided payment should not keep showing on the cheque.
  payment: { select: { id: true, amount: true, paidOn: true, deletedAt: true } },
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

type ChequeWithRelations = Prisma.ChequeGetPayload<{ include: typeof chequeInclude }>;

@Injectable()
export class ChequesService {
  private readonly logger = new Logger(ChequesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListChequesQueryDto): Promise<PaginatedResult<object>> {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      contractId,
      tenantId,
      propertyId,
      buildingId,
      chequeDateFrom,
      chequeDateTo,
      includeDeletedContracts,
      sortBy = 'chequeDate',
      sortOrder = 'asc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.ChequeWhereInput = {
      deletedAt: null,
      ...(contractId && { contractId }),
      contract: {
        ...(includeDeletedContracts ? {} : { deletedAt: null }),
        ...(tenantId && { tenantId }),
        ...(propertyId && { propertyId }),
        ...(buildingId && { property: { buildingId } }),
      },
      ...(status && { status }),
      ...((chequeDateFrom || chequeDateTo) && {
        chequeDate: {
          ...(chequeDateFrom && { gte: new Date(chequeDateFrom) }),
          ...(chequeDateTo && { lte: new Date(chequeDateTo) }),
        },
      }),
      ...(search && { chequeNumber: { contains: search, mode: 'insensitive' as const } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.cheque.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: chequeInclude,
      }),
      this.prisma.cheque.count({ where }),
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
    const cheque = await this.prisma.cheque.findFirst({
      where: { id, deletedAt: null },
      include: chequeInclude,
    });

    if (!cheque) {
      throw new NotFoundException('Cheque not found');
    }

    return this.toResponse(cheque);
  }

  async findAllByContract(contractId: string, query: ListChequesQueryDto) {
    await this.ensureContractExists(contractId);
    return this.findAll({ ...query, contractId });
  }

  async create(dto: CreateChequeDto, userId: string) {
    await this.ensureContractExists(dto.contractId);

    const cheque = await this.createChequeRow(this.prisma, dto, dto.contractId, userId);

    this.logger.log('Cheque created', {
      chequeId: cheque.id,
      contractId: dto.contractId,
      status: cheque.status,
      userId,
      action: 'CREATE_CHEQUE',
    });

    return this.findOne(cheque.id);
  }

  async update(id: string, dto: UpdateChequeDto, userId: string) {
    const current = await this.getActive(id);
    assertTransition('update', current.status as ChequeStatus);

    try {
      await this.prisma.cheque.update({
        where: { id },
        data: {
          ...(dto.chequeNumber !== undefined && { chequeNumber: dto.chequeNumber }),
          ...(dto.bankName !== undefined && { bankName: dto.bankName }),
          ...(dto.amount !== undefined && { amount: new Prisma.Decimal(dto.amount) }),
          ...(dto.chequeDate !== undefined && { chequeDate: new Date(dto.chequeDate) }),
          ...(dto.receivedOn !== undefined && { receivedOn: new Date(dto.receivedOn) }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          updatedById: userId,
        },
      });
    } catch (error) {
      this.rethrowDuplicate(error, dto.bankName ?? current.bankName, dto.chequeNumber ?? current.chequeNumber);
    }

    this.logger.log('Cheque updated', { chequeId: id, userId, action: 'UPDATE_CHEQUE' });

    return this.findOne(id);
  }

  async deposit(id: string, dto: DepositChequeDto, userId: string) {
    const current = await this.getActive(id);
    assertTransition('deposit', current.status as ChequeStatus);

    await this.prisma.cheque.update({
      where: { id },
      data: {
        status: ChequeStatus.DEPOSITED,
        depositedOn: new Date(dto.depositedOn),
        updatedById: userId,
      },
    });

    this.logger.log('Cheque deposited', { chequeId: id, userId, action: 'DEPOSIT_CHEQUE' });

    return this.findOne(id);
  }

  /**
   * DEPOSITED → CLEARED, creating the linked Payment in the SAME transaction.
   * This is the only path from a cheque to a Payment (spec §5.1) — the payment's
   * amount and date are copied from the cheque, never supplied by the caller.
   */
  async clear(id: string, dto: ClearChequeDto, userId: string) {
    const current = await this.getActive(id);
    assertTransition('clear', current.status as ChequeStatus);

    const clearedOn = new Date(dto.clearedOn);

    await this.prisma.$transaction(async (tx) => {
      await tx.cheque.update({
        where: { id },
        data: { status: ChequeStatus.CLEARED, clearedOn, updatedById: userId },
      });

      // A previous clear→bounce cycle leaves a soft-deleted payment behind, and
      // payments.chequeId is UNIQUE, so re-clearing would collide on that row.
      // Revive it instead of inserting a second one.
      const voided = await tx.payment.findUnique({ where: { chequeId: id }, select: { id: true } });

      if (voided) {
        await tx.payment.update({
          where: { id: voided.id },
          data: {
            deletedAt: null,
            kind: dto.kind ?? PaymentKind.RENT,
            amount: current.amount,
            paidOn: clearedOn,
            method: PaymentMethod.CHEQUE,
            notes: dto.notes,
            updatedById: userId,
          },
        });
      } else {
        await tx.payment.create({
          data: {
            contractId: current.contractId,
            kind: dto.kind ?? PaymentKind.RENT,
            amount: current.amount,
            paidOn: clearedOn,
            method: PaymentMethod.CHEQUE,
            chequeId: id,
            notes: dto.notes,
            createdById: userId,
          },
        });
      }
    });

    this.logger.log('Cheque cleared and payment recorded', {
      chequeId: id,
      contractId: current.contractId,
      userId,
      action: 'CLEAR_CHEQUE',
    });

    return this.findOne(id);
  }

  /**
   * → BOUNCED, from DEPOSITED or CLEARED.
   *
   * Bouncing a CLEARED cheque voids its Payment in the same transaction: a
   * bounced cheque must never leave money counted as received (spec §5.2). The
   * payment is soft-deleted, not removed, so the reversal stays auditable.
   */
  async bounce(id: string, dto: BounceChequeDto, userId: string) {
    const current = await this.getActive(id);
    assertTransition('bounce', current.status as ChequeStatus);

    const livePayment = await this.prisma.payment.findFirst({
      where: { chequeId: id, deletedAt: null },
      select: { id: true },
    });

    // From DEPOSITED there should be no payment at all — if one exists the record
    // is inconsistent (spec §5.1 says reject rather than guess).
    if (current.status === ChequeStatus.DEPOSITED && livePayment) {
      throw new ConflictException(
        'This deposited cheque already has a payment recorded against it, which should not be possible. ' +
          'Resolve the payment before bouncing the cheque.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cheque.update({
        where: { id },
        data: {
          status: ChequeStatus.BOUNCED,
          bouncedOn: new Date(dto.bouncedOn),
          bounceReason: dto.bounceReason,
          updatedById: userId,
        },
      });

      if (livePayment) {
        await tx.payment.update({
          where: { id: livePayment.id },
          data: { deletedAt: new Date(), updatedById: userId },
        });
      }
    });

    this.logger.log('Cheque bounced', {
      chequeId: id,
      previousStatus: current.status,
      paymentVoided: Boolean(livePayment),
      userId,
      action: 'BOUNCE_CHEQUE',
    });

    return this.findOne(id);
  }

  /**
   * Creates the replacement cheque and marks the original REPLACED, atomically.
   * The replacement inherits the original's contract and starts HELD.
   *
   * replacedByChequeId is UNIQUE, so a second attempt to replace the same cheque
   * is caught by the status guard, and two cheques can never claim the same
   * replacement.
   */
  async replace(id: string, dto: ReplaceChequeDto, userId: string) {
    const current = await this.getActive(id);
    assertTransition('replace', current.status as ChequeStatus);

    if (current.replacedByChequeId) {
      throw new ConflictException('This cheque has already been replaced');
    }

    const replacement = await this.prisma
      .$transaction(async (tx) => {
        const created = await this.createChequeRow(tx, dto, current.contractId, userId);

        await tx.cheque.update({
          where: { id },
          data: {
            status: ChequeStatus.REPLACED,
            replacedByChequeId: created.id,
            ...(dto.replacementNotes !== undefined && { notes: dto.replacementNotes }),
            updatedById: userId,
          },
        });

        return created;
      })
      .catch((error) => this.rethrowDuplicate(error, dto.bankName, dto.chequeNumber));

    this.logger.log('Cheque replaced', {
      chequeId: id,
      replacementChequeId: replacement.id,
      userId,
      action: 'REPLACE_CHEQUE',
    });

    return this.findOne(replacement.id);
  }

  async cancel(id: string, dto: CancelChequeDto, userId: string) {
    const current = await this.getActive(id);
    assertTransition('cancel', current.status as ChequeStatus);

    await this.prisma.cheque.update({
      where: { id },
      data: {
        status: ChequeStatus.CANCELLED,
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedById: userId,
      },
    });

    this.logger.log('Cheque cancelled', { chequeId: id, userId, action: 'CANCEL_CHEQUE' });

    return this.findOne(id);
  }

  async remove(id: string, userId: string) {
    const current = await this.getActive(id);
    assertTransition('delete', current.status as ChequeStatus);

    const cheque = await this.prisma.cheque.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
      include: chequeInclude,
    });

    this.logger.log('Cheque soft deleted', {
      chequeId: id,
      previousStatus: current.status,
      userId,
      action: 'DELETE_CHEQUE',
    });

    return this.toResponse(cheque);
  }

  /** Shared by create() and replace() so both build the row identically. */
  private async createChequeRow(
    client: Pick<PrismaService, 'cheque'> | Prisma.TransactionClient,
    dto: Omit<CreateChequeDto, 'contractId'>,
    contractId: string,
    userId: string,
  ) {
    return client.cheque.create({
      data: {
        contractId,
        chequeNumber: dto.chequeNumber,
        bankName: dto.bankName,
        amount: new Prisma.Decimal(dto.amount),
        chequeDate: new Date(dto.chequeDate),
        receivedOn: new Date(dto.receivedOn),
        status: ChequeStatus.HELD,
        notes: dto.notes,
        createdById: userId,
      },
      select: { id: true, status: true },
    });
  }

  private async getActive(id: string) {
    const cheque = await this.prisma.cheque.findFirst({ where: { id, deletedAt: null } });
    if (!cheque) {
      throw new NotFoundException('Cheque not found');
    }
    return cheque;
  }

  private async ensureContractExists(contractId: string): Promise<void> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }
  }

  /**
   * Turns the partial unique index violation on (bankName, chequeNumber) into a
   * message that names the clash, rather than leaking a Prisma error. Only live
   * rows are covered by that index, so a soft-deleted cheque's number is reusable.
   */
  private rethrowDuplicate(error: unknown, bankName: string, chequeNumber: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(
        `Cheque ${chequeNumber} from ${bankName} already exists. ` +
          'Cheque numbers must be unique within a bank.',
      );
    }
    throw error;
  }

  private toResponse(cheque: ChequeWithRelations) {
    const { amount, payment, replacedBy, replaces, ...rest } = cheque;

    return {
      ...rest,
      amount: toMoneyString(amount),
      // Hide a voided payment: after a cleared cheque bounces, the money is no
      // longer received and the cheque should not appear to have a payment.
      payment:
        payment && !payment.deletedAt
          ? { id: payment.id, amount: toMoneyString(payment.amount), paidOn: payment.paidOn }
          : null,
      replacedBy: replacedBy ? { ...replacedBy, amount: toMoneyString(replacedBy.amount) } : null,
      replaces: replaces ? { ...replaces, amount: toMoneyString(replaces.amount) } : null,
    };
  }
}
