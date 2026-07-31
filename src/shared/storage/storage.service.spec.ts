import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/file'),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    mockSend.mockReset();
    (getSignedUrl as jest.Mock).mockClear();

    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          STORAGE_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
          STORAGE_BUCKET: 'test-bucket',
          STORAGE_REGION: 'auto',
          STORAGE_ACCESS_KEY_ID: 'test-key',
          STORAGE_SECRET_ACCESS_KEY: 'test-secret',
        };
        return values[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StorageService, { provide: ConfigService, useValue: configService }],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadFile', () => {
    it('should upload the buffer and return the storage key', async () => {
      mockSend.mockResolvedValue({});

      const key = await service.uploadFile(
        'tenants/t1/EMIRATES_ID/file.pdf',
        Buffer.from('data'),
        'application/pdf',
      );

      expect(key).toBe('tenants/t1/EMIRATES_ID/file.pdf');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSignedUrl', () => {
    it('should generate a signed URL with the requested expiry', async () => {
      const url = await service.getSignedUrl('tenants/t1/EMIRATES_ID/file.pdf', 300);

      expect(url).toBe('https://signed-url.example.com/file');
      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 300,
      });
    });

    it('should default to a 300 second expiry when none is given', async () => {
      await service.getSignedUrl('tenants/t1/EMIRATES_ID/file.pdf');

      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 300,
      });
    });
  });

  describe('deleteFile', () => {
    it('should send a delete request for the given key', async () => {
      mockSend.mockResolvedValue({});

      await service.deleteFile('tenants/t1/EMIRATES_ID/file.pdf');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
