import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import * as path from 'path';

@Injectable()
export class FilesService implements OnModuleInit {
  private logger = new Logger(FilesService.name);
  private s3!: S3Client;
  private bucket!: string;
  private publicBase!: string;

  constructor(private cfg: ConfigService) {}

  async onModuleInit() {
    this.bucket = this.cfg.get<string>('s3.bucket') ?? 'smartfleet';
    const endpoint = this.cfg.get<string>('s3.endpoint') ?? 'http://localhost:9000';
    this.publicBase = endpoint;
    this.s3 = new S3Client({
      endpoint,
      region: this.cfg.get<string>('s3.region') ?? 'us-east-1',
      credentials: {
        accessKeyId: this.cfg.get<string>('s3.accessKey') ?? 'minio',
        secretAccessKey: this.cfg.get<string>('s3.secretKey') ?? 'minio123',
      },
      forcePathStyle: true,
    });
    await this.ensureBucket();
  }

  private async ensureBucket() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
        // Make read access public so URLs are usable without signing
        await this.s3.send(
          new PutBucketPolicyCommand({
            Bucket: this.bucket,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { AWS: ['*'] },
                  Action: ['s3:GetObject'],
                  Resource: [`arn:aws:s3:::${this.bucket}/*`],
                },
              ],
            }),
          }),
        );
      } catch (e) {
        this.logger.warn(`Could not ensure bucket ${this.bucket}: ${(e as Error).message}`);
      }
    }
  }

  async upload(file: { buffer: Buffer; originalname: string; mimetype: string }) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    const url = `${this.publicBase}/${this.bucket}/${key}`;
    return { url, key, mimeType: file.mimetype, size: file.buffer.length };
  }

  /**
   * Turn a stored object URL (or bare key) into a short-lived presigned GET
   * URL so it can be viewed in a browser even when the bucket is private
   * (default for our infra-created buckets). Payment slips contain bank
   * details, so we deliberately keep the bucket non-public and sign on read.
   *
   * Keys are always `uploads/…`; we locate that marker so the sign works
   * regardless of which endpoint host was baked into the stored URL. Returns
   * the original value if it can't be signed, and null passes through.
   */
  async signStoredUrl(storedUrl: string | null, expiresIn = 3600): Promise<string | null> {
    if (!storedUrl) return null;
    const idx = storedUrl.indexOf('uploads/');
    if (idx === -1) return storedUrl;
    const key = storedUrl.slice(idx).split('?')[0];
    try {
      return await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn },
      );
    } catch (e) {
      this.logger.warn(`Could not sign ${key}: ${(e as Error).message}`);
      return storedUrl;
    }
  }
}
