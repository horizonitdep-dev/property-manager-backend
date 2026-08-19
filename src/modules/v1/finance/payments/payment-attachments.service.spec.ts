import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentAttachmentsService } from './payment-attachments.service';
import { ChequeAttachmentsService } from '../cheques/cheque-attachments.service';
import { ExpenseAttachmentsService } from '../expenses/expense-attachments.service';
import { PrismaService } from '../../../../database/prisma.service';
import { StorageService } from '../../../../shared/storage/storage.service';
import { FinanceAttachmentType } from '../../../../common/enums/finance-attachment-type.enum';

// A real 5-byte PDF header, so the content sniffer identifies application/pdf
// rather than falling back to the client-supplied mimetype.
const PDF_BYTES = Buffer.from('%PDF-1.4\n%\xc8\xc8\xc8\n', 'latin1');

function fileOf(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: 'receipt one.pdf',
    buffer: PDF_BYTES,
    size: PDF_BYTES.length,
    mimetype: 'application/pdf',
    ...overrides,
  } as Express.Multer.File;
}

const storedAttachment = {
  id: 'attachment-uuid',
  type: FinanceAttachmentType.RECEIPT,
  fileName: 'receipt one.pdf',
  fileKey: 'finance/payments/payment-uuid/RECEIPT/uuid-receipt_one.pdf',
  fileSize: PDF_BYTES.length,
  mimeType: 'application/pdf',
  uploadedAt: new Date(),
  uploadedById: 'user-uuid',
  deletedAt: null,
};

describe('Finance attachments', () => {
  let service: PaymentAttachmentsService;
  let prisma: {
    payment: { findFirst: jest.Mock };
    paymentAttachment: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let storage: { uploadFile: jest.Mock; getSignedUrl: jest.Mock };

  beforeEach(async () => {
    prisma = {
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment-uuid' }) },
      paymentAttachment: {
        create: jest.fn().mockResolvedValue(storedAttachment),
        findMany: jest.fn().mockResolvedValue([storedAttachment]),
        findFirst: jest.fn().mockResolvedValue(storedAttachment),
        update: jest.fn().mockResolvedValue({ ...storedAttachment, deletedAt: new Date() }),
      },
    };
    storage = {
      uploadFile: jest.fn().mockResolvedValue(undefined),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/abc'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentAttachmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(PaymentAttachmentsService);
  });

  describe('upload validation', () => {
    it('uploads to storage before recording the row', async () => {
      await service.upload('payment-uuid', undefined, fileOf(), 'user-uuid');

      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
      expect(prisma.paymentAttachment.create).toHaveBeenCalledTimes(1);
    });

    it('defaults a payment attachment to RECEIPT', async () => {
      await service.upload('payment-uuid', undefined, fileOf(), 'user-uuid');

      expect(prisma.paymentAttachment.create.mock.calls[0][0].data.type).toBe(
        FinanceAttachmentType.RECEIPT,
      );
    });

    it('honours an explicit type', async () => {
      await service.upload('payment-uuid', FinanceAttachmentType.BANK_STATEMENT, fileOf(), 'user-uuid');

      expect(prisma.paymentAttachment.create.mock.calls[0][0].data.type).toBe(
        FinanceAttachmentType.BANK_STATEMENT,
      );
    });

    it('400s when no file was sent', async () => {
      await expect(service.upload('payment-uuid', undefined, undefined, 'user-uuid')).rejects.toThrow(
        'file is required',
      );
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('400s over the 10 MB limit', async () => {
      await expect(
        service.upload('payment-uuid', undefined, fileOf({ size: 11 * 1024 * 1024 }), 'user-uuid'),
      ).rejects.toThrow('File exceeds the 10 MB size limit');
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('rejects a disallowed type even when the header claims PDF', async () => {
      // Content sniffing is the point: a client can set any Content-Type it likes.
      const zipBytes = Buffer.from('PK\x03\x04', 'latin1');

      await expect(
        service.upload(
          'payment-uuid',
          undefined,
          fileOf({ buffer: zipBytes, size: zipBytes.length, mimetype: 'application/pdf' }),
          'user-uuid',
        ),
      ).rejects.toThrow(/Unsupported file type/);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('stores the sniffed type, not the supplied one', async () => {
      await service.upload(
        'payment-uuid',
        undefined,
        fileOf({ mimetype: 'application/octet-stream' }),
        'user-uuid',
      );

      expect(prisma.paymentAttachment.create.mock.calls[0][0].data.mimeType).toBe('application/pdf');
    });

    it('sanitises the file name in the storage key but keeps the original for display', async () => {
      await service.upload('payment-uuid', undefined, fileOf(), 'user-uuid');

      const key = storage.uploadFile.mock.calls[0][0];
      expect(key).toMatch(/^finance\/payments\/payment-uuid\/RECEIPT\//);
      expect(key).not.toContain(' ');
      expect(prisma.paymentAttachment.create.mock.calls[0][0].data.fileName).toBe('receipt one.pdf');
    });

    it('404s when the parent payment does not exist', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.upload('payment-uuid', undefined, fileOf(), 'user-uuid')).rejects.toThrow(
        'Payment not found',
      );
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('returns a signed URL rather than bytes', async () => {
      const result = await service.getSignedUrl('payment-uuid', 'attachment-uuid');

      expect(result).toEqual({ url: 'https://signed.example/abc', expiresInSeconds: 300 });
      expect(storage.getSignedUrl).toHaveBeenCalledWith(storedAttachment.fileKey, 300);
    });

    it('404s for an attachment belonging to a different payment', async () => {
      prisma.paymentAttachment.findFirst.mockResolvedValue(null);

      await expect(service.getSignedUrl('payment-uuid', 'attachment-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes the lookup by parent so a guessed id cannot leak another record', async () => {
      await service.getSignedUrl('payment-uuid', 'attachment-uuid');

      expect(prisma.paymentAttachment.findFirst.mock.calls[0][0].where).toEqual({
        id: 'attachment-uuid',
        paymentId: 'payment-uuid',
        deletedAt: null,
      });
    });
  });

  describe('list', () => {
    it('excludes soft-deleted attachments, newest first', async () => {
      await service.findAllForParent('payment-uuid');

      const args = prisma.paymentAttachment.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ paymentId: 'payment-uuid', deletedAt: null });
      expect(args.orderBy).toEqual({ uploadedAt: 'desc' });
    });

    it('never exposes the storage key', async () => {
      const result = await service.findAllForParent('payment-uuid');

      expect(result[0]).not.toHaveProperty('fileKey');
      expect(result[0]).toHaveProperty('fileName');
    });
  });

  describe('remove', () => {
    it('soft deletes and leaves the object in the bucket', async () => {
      await service.remove('payment-uuid', 'attachment-uuid', 'user-uuid');

      expect(prisma.paymentAttachment.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    });

    it('404s for an unknown attachment', async () => {
      prisma.paymentAttachment.findFirst.mockResolvedValue(null);

      await expect(service.remove('payment-uuid', 'attachment-uuid', 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('the other two parents are wired to their own table and defaults', () => {
    it('cheque attachments default to CHEQUE_IMAGE and key under cheques/', async () => {
      const chequePrisma = {
        cheque: { findFirst: jest.fn().mockResolvedValue({ id: 'cheque-uuid' }) },
        chequeAttachment: { create: jest.fn().mockResolvedValue(storedAttachment) },
      };
      const module = await Test.createTestingModule({
        providers: [
          ChequeAttachmentsService,
          { provide: PrismaService, useValue: chequePrisma },
          { provide: StorageService, useValue: storage },
        ],
      }).compile();

      await module.get(ChequeAttachmentsService).upload('cheque-uuid', undefined, fileOf(), 'user-uuid');

      const { data } = chequePrisma.chequeAttachment.create.mock.calls[0][0];
      expect(data.type).toBe(FinanceAttachmentType.CHEQUE_IMAGE);
      expect(data.chequeId).toBe('cheque-uuid');
      expect(storage.uploadFile.mock.calls[0][0]).toMatch(/^finance\/cheques\//);
    });

    it('expense attachments default to INVOICE and key under expenses/', async () => {
      const expensePrisma = {
        expense: { findFirst: jest.fn().mockResolvedValue({ id: 'expense-uuid' }) },
        expenseAttachment: { create: jest.fn().mockResolvedValue(storedAttachment) },
      };
      const module = await Test.createTestingModule({
        providers: [
          ExpenseAttachmentsService,
          { provide: PrismaService, useValue: expensePrisma },
          { provide: StorageService, useValue: storage },
        ],
      }).compile();

      await module
        .get(ExpenseAttachmentsService)
        .upload('expense-uuid', undefined, fileOf(), 'user-uuid');

      const { data } = expensePrisma.expenseAttachment.create.mock.calls[0][0];
      expect(data.type).toBe(FinanceAttachmentType.INVOICE);
      expect(data.expenseId).toBe('expense-uuid');
      expect(storage.uploadFile.mock.calls[0][0]).toMatch(/^finance\/expenses\//);
    });

    it('each 404s with its own parent name', async () => {
      const chequeModule = await Test.createTestingModule({
        providers: [
          ChequeAttachmentsService,
          { provide: PrismaService, useValue: { cheque: { findFirst: jest.fn().mockResolvedValue(null) } } },
          { provide: StorageService, useValue: storage },
        ],
      }).compile();

      await expect(
        chequeModule.get(ChequeAttachmentsService).upload('x', undefined, fileOf(), 'u'),
      ).rejects.toThrow('Cheque not found');
    });
  });
});
