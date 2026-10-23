import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Prisma, UserRole, type StoredFile, type StoredFilePurpose } from '@prisma/client';
import { UPLOAD_MAX_MB, type FileUploadResult } from '@smartfleet/shared-types';
import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import type { UserActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { PrismaService } from '../../prisma/prisma.service';
import { detectImageType } from './file-type';

/** Signed GET URLs last one hour (API_CONTRACT §5.8). */
export const SIGNED_URL_TTL_SECONDS = 3600;
export const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_KEY = /uploads\/[^?#\s]+/;

/** An uploaded file as multer hands it over. */
export interface IncomingFile {
  buffer: Buffer;
  originalname?: string;
}

/** Who may use a file: its purpose, and optionally who uploaded it. */
export interface FileUse {
  purpose: StoredFilePurpose;
  uploadedByUserId?: string;
}

/**
 * The stored purpose of an upload (API_CONTRACT §7.10): the role's default when none is sent
 * (DISTRIBUTOR → TOPUP_PROOF, others → OTHER); EXPENSE_RECEIPT is office only; day-end files are
 * made by their own routes (Inc 3), never by the picture upload.
 */
export function resolveUploadPurpose(requested: StoredFilePurpose | undefined, role: UserRole): StoredFilePurpose {
  const purpose = requested ?? (role === UserRole.DISTRIBUTOR ? 'TOPUP_PROOF' : 'OTHER');
  if (purpose === 'EXPENSE_RECEIPT' && role !== UserRole.SUPER_ADMIN) throw new AppError('PERMISSION_DENIED');
  if (purpose === 'DAY_END_SHEET' || purpose === 'DAY_END_UPLOAD') {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'purpose', code: 'INVALID_CHOICE', message: validationMessage('INVALID_CHOICE') }],
    });
  }
  return purpose;
}

/** A display name kept for the office (never used as a key): no folders, no control characters. */
function safeOriginalName(name: string | undefined): string | null {
  if (!name) return null;
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base ? base.slice(0, 200) : null;
}

/**
 * Pictures in private object storage, one `stored_files` row each (API_CONTRACT §5.8, §7.10).
 * The bucket is never public: every URL handed out is signed for an hour.
 */
@Injectable()
export class FilesService implements OnModuleInit {
  private logger = new Logger(FilesService.name);
  private s3!: S3Client;
  private bucket!: string;

  constructor(
    private cfg: ConfigService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.bucket = this.cfg.get<string>('s3.bucket') ?? 'smartfleet';
    // Local MinIO by default; production and staging without S3_ENDPOINT use the AWS endpoint.
    const deployed = ['production', 'staging'].includes(process.env.NODE_ENV ?? '');
    const endpoint = this.cfg.get<string>('s3.endpoint') || (deployed ? undefined : 'http://localhost:9000');
    this.s3 = new S3Client({
      endpoint,
      region: this.cfg.get<string>('s3.region') ?? 'us-east-1',
      credentials: {
        accessKeyId: this.cfg.get<string>('s3.accessKey') ?? 'minio',
        secretAccessKey: this.cfg.get<string>('s3.secretKey') ?? 'minio123',
      },
      // MinIO and R2 need path-style URLs; AWS works with its default.
      forcePathStyle: endpoint !== undefined,
    });
    // In the background: storage being slow or down must not hold up the API's boot.
    void this.ensureBucket();
  }

  /** Creates the bucket when it doesn't exist (local MinIO). It stays private: no bucket policy is set. */
  private async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) {
        this.logger.warn(`Could not check bucket ${this.bucket}: ${(error as Error).message}`);
        return;
      }
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created private bucket ${this.bucket}`);
      } catch (e) {
        this.logger.warn(`Could not create bucket ${this.bucket}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Stores one picture (JPEG, PNG or WebP by magic bytes, at most 5 MB) and its `stored_files` row.
   * The same uploader sending the same bytes for the same purpose gets the existing row back.
   */
  async upload(
    file: IncomingFile | undefined,
    p: { purpose?: StoredFilePurpose; actor: UserActor },
  ): Promise<FileUploadResult> {
    if (!file?.buffer) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'file', code: 'REQUIRED', message: validationMessage('REQUIRED') }],
      });
    }
    const purpose = resolveUploadPurpose(p.purpose, p.actor.role);
    const size = file.buffer.length;
    if (size > UPLOAD_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', { maxMb: UPLOAD_MAX_MB });
    const type = detectImageType(file.buffer);
    if (!type) throw new AppError('FILE_TYPE_NOT_ALLOWED');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const existing = await this.prisma.storedFile.findFirst({
      where: { uploadedByUserId: p.actor.userId, sha256, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.toUploadResult(existing);

    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${type.extension}`;
    try {
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.buffer, ContentType: type.mimeType }),
      );
    } catch (error) {
      this.logger.error(`Upload to ${this.bucket} failed: ${(error as Error).message}`);
      throw new AppError('SERVICE_UNAVAILABLE', undefined, { cause: error });
    }

    let row: StoredFile;
    try {
      row = await this.prisma.storedFile.create({
        data: {
          storageKey: key,
          purpose,
          mimeType: type.mimeType,
          sizeBytes: size,
          sha256,
          originalName: safeOriginalName(file.originalname),
          uploadedByUserId: p.actor.userId,
          distributorId: p.actor.role === UserRole.DISTRIBUTOR ? p.actor.distributorId ?? null : null,
        },
      });
    } catch (error) {
      // Best effort: don't leave an object nobody can reach.
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
      throw error;
    }
    return this.toUploadResult(row);
  }

  /** `GET /files/:id/url`: a fresh 1-hour URL for the uploader or the office; FILE_NOT_FOUND otherwise. */
  async signedUrl(fileId: string, actor: Pick<UserActor, 'userId' | 'role'>): Promise<string> {
    const file = UUID.test(fileId) ? await this.prisma.storedFile.findUnique({ where: { id: fileId } }) : null;
    if (!file || (actor.role !== UserRole.SUPER_ADMIN && file.uploadedByUserId !== actor.userId)) {
      throw new AppError('FILE_NOT_FOUND');
    }
    return this.urlFor(file);
  }

  /**
   * For services that link a file to a record (a top-up proof, an expense receipt): the file exists
   * with this purpose (and uploader, when given), else FILE_NOT_FOUND. Pass `tx` inside a transaction.
   *
   *   await files.assertUsable(body.proofFileId, { purpose: 'TOPUP_PROOF', uploadedByUserId: actor.userId }, tx);
   *   await files.assertUsable(body.receiptFileId, { purpose: 'EXPENSE_RECEIPT' }); // office-only uploads
   */
  async assertUsable(fileId: string, p: FileUse, tx?: Prisma.TransactionClient): Promise<StoredFile> {
    const db = tx ?? this.prisma;
    const file =
      typeof fileId === 'string' && UUID.test(fileId)
        ? await db.storedFile.findFirst({
            where: { id: fileId, purpose: p.purpose, ...(p.uploadedByUserId ? { uploadedByUserId: p.uploadedByUserId } : {}) },
          })
        : null;
    if (!file) throw new AppError('FILE_NOT_FOUND');
    return file;
  }

  /**
   * The legacy form of {@link assertUsable}, for installed apps that send a URL
   * (`POST /payments/:id/bank-proof`): the `uploads/…` key inside it must be a stored file.
   */
  async assertUsableUrl(urlOrKey: string, p: FileUse, tx?: Prisma.TransactionClient): Promise<StoredFile> {
    const db = tx ?? this.prisma;
    const key = typeof urlOrKey === 'string' ? STORAGE_KEY.exec(urlOrKey)?.[0] : undefined;
    const file = key
      ? await db.storedFile.findFirst({
          where: { storageKey: key, purpose: p.purpose, ...(p.uploadedByUserId ? { uploadedByUserId: p.uploadedByUserId } : {}) },
        })
      : null;
    if (!file) throw new AppError('FILE_NOT_FOUND');
    return file;
  }

  /** A 1-hour signed GET URL for a stored file (for DTOs such as PaymentDto.proofUrl). */
  urlFor(file: Pick<StoredFile, 'storageKey'>): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }

  /**
   * Turn a stored object URL (or bare key) into a short-lived presigned GET
   * URL so it can be viewed in a browser even though the bucket is private.
   * Payment slips contain bank details, so the bucket stays non-public and
   * every read is signed.
   *
   * Keys are always `uploads/…`; we locate that marker so the sign works
   * regardless of which endpoint host was baked into the stored URL. Returns
   * the original value if it can't be signed, and null passes through.
   */
  async signStoredUrl(storedUrl: string | null, expiresIn = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
    if (!storedUrl) return null;
    const idx = storedUrl.indexOf('uploads/');
    if (idx === -1) return storedUrl;
    const key = storedUrl.slice(idx).split('?')[0];
    try {
      return await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
    } catch (e) {
      this.logger.warn(`Could not sign ${key}: ${(e as Error).message}`);
      return storedUrl;
    }
  }

  private async toUploadResult(file: StoredFile): Promise<FileUploadResult> {
    return {
      fileId: file.id,
      key: file.storageKey,
      url: await this.urlFor(file),
      mimeType: file.mimeType,
      size: file.sizeBytes,
    };
  }
}
