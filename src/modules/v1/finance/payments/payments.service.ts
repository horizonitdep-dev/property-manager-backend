import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { PaginatedResult } from '../../../../common/dtos/pagination.dto';
import { PaymentKind } from '../../../../common/enums/payment-kind.enum';
import { PaymentMethod } from '../../../../common/enums/payment-method.enum';
import { toMoneyString } from '../shared/finance-money.util';
import { CreatePaymentDto } from './dtos/create-payment.dto';
import { UpdatePaymentDto } from './dtos/update-payment.dto';
import { ListPaymentsQueryDto } from './dtos/list-payments.query.dto';

const paymentInclude = {
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
  cheque: { select: { id: true, chequeNumber: true, bankName: true } },
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

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

/** Fields the cheque owns once it has cleared — editing them on the Payment would
 * let the two disagree about how much money actually moved (spec §5.2). */
const CHEQUE_OWNED_FIELDS = ['amount', 'paidOn'] as const;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListPaymentsQueryDto): Promise<PaginatedResult<object>> {
    const {
      page = 1,
      limit = 10,
      search,
      contractId,
      tenantId,
      propertyId,
      buildingId,
      method,
      kind,
      paidOnFrom,
      paidOnTo,
      linkedToCheque,
      includeDeletedContracts,
      sortBy = 'paidOn',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    // tenantId/propertyId/buildingId are all reached THROUGH the contract —
    // Finance never denormalises them onto Payment, so the contract stays the
    // single source of truth for who and what a payment relates to.
    const contractFilter: Prisma.ContractWhereInput = {
      ...(includeDeletedContracts ? {} : { deletedAt: null }),
      ...(tenantId && { tenantId }),
      ...(propertyId && { propertyId }),
      ...(buildingId && { property: { buildingId } }),
    };

    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      ...(contractId && { contractId }),
      contract: contractFilter,
      ...(method && { method }),
      ...(kind && { kind }),
      ...((paidOnFrom || paidOnTo) && {
        paidOn: {
          ...(paidOnFrom && { gte: new Date(paidOnFrom) }),
          ...(paidOnTo && { lte: new Date(paidOnTo) }),
        },
      }),
      ...(linkedToCheque !== undefined && { chequeId: linkedToCheque ? { not: null } : null }),
      ...(search && { referenceNumber: { contains: search, mode: 'insensitive' as const } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: paymentInclude,
      }),
      this.prisma.payment.count({ where }),
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
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
      include: paymentInclude,
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return this.toResponse(payment);
  }

  /** Payment history for one contract, newest first. */
  async findAllByContract(contractId: string, query: ListPaymentsQueryDto) {
    await this.ensureContractExists(contractId);
    return this.findAll({ ...query, contractId });
  }

  async create(dto: CreatePaymentDto, userId: string) {
    await this.ensureContractExists(dto.contractId);

    // Recording a cheque as a plain payment bypasses the whole cheque lifecycle
    // (no HELD/DEPOSITED tracking, no bounce handling). Allowed per spec §5.2 but
    // logged so it can be spotted, since it is nearly always a mistake.
    if (dto.method === PaymentMethod.CHEQUE) {
      this.logger.warn('Manual payment recorded with method=CHEQUE, bypassing the cheque lifecycle', {
        contractId: dto.contractId,
        userId,
        action: 'CREATE_PAYMENT_CHEQUE_BYPASS',
      });
    }

    const payment = await this.prisma.payment.create({
      data: {
        contractId: dto.contractId,
        kind: dto.kind ?? PaymentKind.RENT,
        amount: new Prisma.Decimal(dto.amount),
        paidOn: new Date(dto.paidOn),
        method: dto.method,
        ...(dto.periodStart && { periodStart: new Date(dto.periodStart) }),
        ...(dto.periodEnd && { periodEnd: new Date(dto.periodEnd) }),
        referenceNumber: dto.referenceNumber,
        notes: dto.notes,
        createdById: userId,
      },
      include: paymentInclude,
    });

    this.logger.log('Payment created', {
      paymentId: payment.id,
      contractId: dto.contractId,
      kind: payment.kind,
      userId,
      action: 'CREATE_PAYMENT',
    });

    return this.toResponse(payment);
  }

  async update(id: string, dto: UpdatePaymentDto, userId: string) {
    const current = await this.prisma.payment.findFirst({ where: { id, deletedAt: null } });
    if (!current) {
      throw new NotFoundException('Payment not found');
    }

    // A cheque-linked payment mirrors its cheque. Metadata (notes, reference,
    // period, kind) stays editable; the money itself does not.
    if (current.chequeId) {
      const attempted = CHEQUE_OWNED_FIELDS.filter((field) => dto[field] !== undefined);
      if (attempted.length > 0) {
        throw new ConflictException(
          `Cannot change ${attempted.join(', ')} on a payment created from a cheque — ` +
            'the cheque is the source of truth. To correct it, mark the cheque BOUNCED or ' +
            'soft-delete this payment and record the correction against the cheque.',
        );
      }
    }

    const payment = await this.prisma.payment.update({
      where: { id },
      data: {
        ...(dto.kind !== undefined && { kind: dto.kind }),
        ...(dto.amount !== undefined && { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.paidOn !== undefined && { paidOn: new Date(dto.paidOn) }),
        ...(dto.method !== undefined && { method: dto.method }),
        ...(dto.periodStart !== undefined && { periodStart: new Date(dto.periodStart) }),
        ...(dto.periodEnd !== undefined && { periodEnd: new Date(dto.periodEnd) }),
        ...(dto.referenceNumber !== undefined && { referenceNumber: dto.referenceNumber }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedById: userId,
      },
      include: paymentInclude,
    });

    this.logger.log('Payment updated', { paymentId: id, userId, action: 'UPDATE_PAYMENT' });

    return this.toResponse(payment);
  }

  async remove(id: string, userId: string) {
    const current = await this.prisma.payment.findFirst({ where: { id, deletedAt: null } });
    if (!current) {
      throw new NotFoundException('Payment not found');
    }

    const payment = await this.prisma.payment.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
      include: paymentInclude,
    });

    this.logger.log('Payment soft deleted', {
      paymentId: id,
      chequeLinked: Boolean(current.chequeId),
      userId,
      action: 'DELETE_PAYMENT',
    });

    return this.toResponse(payment);
  }

  /** 404s unless the contract exists and is not soft-deleted (spec §5.2). */
  private async ensureContractExists(contractId: string): Promise<void> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }
  }

  private toResponse(payment: PaymentWithRelations) {
    const { amount, ...rest } = payment;

    return {
      ...rest,
      // String, not number — see PaymentResponseDto.amount for why.
      amount: toMoneyString(amount),
      isChequeLinked: payment.chequeId !== null,
    };
  }
}
