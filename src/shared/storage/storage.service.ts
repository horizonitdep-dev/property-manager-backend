import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    this.bucket = configService.getOrThrow<string>('STORAGE_BUCKET');
    this.client = new S3Client({
      endpoint: configService.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: configService.getOrThrow<string>('STORAGE_REGION'),
      credentials: {
        accessKeyId: configService.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: configService.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY'),
      },
    });
  }

  async uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return key;
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}
