import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { UserActor } from '../../src/common/auth/actor';
import { AppError } from '../../src/common/errors/app-error';
import { detectImageType } from '../../src/modules/files/file-type';
import { FilesService, resolveUploadPurpose, UPLOAD_MAX_BYTES } from '../../src/modules/files/files.service';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of png')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jfif')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj');

interface StoredRow {
  id: string;
  storageKey: string;
  purpose: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalName: string | null;
  uploadedByUserId: string;
  distributorId: string | null;
  createdAt: Date;
}

class FakePrisma {
  rows: StoredRow[] = [];
  storedFile = {
    findFirst: jest.fn(async ({ where }: { where: Partial<StoredRow> }) => {
      return (
        this.rows.find((row) =>
          Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value),
        ) ?? null
      );
    }),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => this.rows.find((row) => row.id === where.id) ?? null),
    create: jest.fn(async ({ data }: { data: Omit<StoredRow, 'id' | 'createdAt'> }) => {
      const row = { ...data, id: `00000000-0000-4000-8000-${String(this.rows.length + 1).padStart(12, '0')}`, createdAt: new Date() };
      this.rows.push(row);
      return row;
    }),
  };
}

function service() {
  const prisma = new FakePrisma();
  const config = new ConfigService({
    s3: { bucket: 'sf-unit', endpoint: 'http://127.0.0.1:9', accessKey: 'key', secretKey: 'secret', region: 'us-east-1' },
  });
  const files = new FilesService(config, prisma as never);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  // Object storage is faked; URL signing is local and needs no network.
  const send = jest.spyOn(S3Client.prototype, 'send').mockImplementation((async () => ({})) as never);
  files.onModuleInit();
  send.mockClear();
  return { files, prisma, send };
}

const shop: UserActor = { kind: 'USER', userId: 'u-shop', role: 'DISTRIBUTOR', distributorId: 'd-1' };
const driver: UserActor = { kind: 'USER', userId: 'u-driver', role: 'DRIVER', driverId: 'dr-1' };
const office: UserActor = { kind: 'USER', userId: 'u-office', role: 'SUPER_ADMIN' };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
}

afterEach(() => jest.restoreAllMocks());

describe('picture type by magic bytes (API_CONTRACT §7.10)', () => {
  it('knows JPEG, PNG and WebP', () => {
    expect(detectImageType(JPEG)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
    expect(detectImageType(PNG)).toEqual({ mimeType: 'image/png', extension: 'png' });
    expect(detectImageType(WEBP)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('refuses everything else, whatever the name says', () => {
    expect(detectImageType(PDF)).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from('RIFF0000WAVE'))).toBeNull();
  });
});

describe('upload purposes', () => {
  it('defaults by role', () => {
    expect(resolveUploadPurpose(undefined, 'DISTRIBUTOR')).toBe('TOPUP_PROOF');
    expect(resolveUploadPurpose(undefined, 'DRIVER')).toBe('OTHER');
    expect(resolveUploadPurpose(undefined, 'SUPER_ADMIN')).toBe('OTHER');
  });

  it('keeps EXPENSE_RECEIPT for the office and day-end files for their own routes', () => {
    expect(resolveUploadPurpose('EXPENSE_RECEIPT', 'SUPER_ADMIN')).toBe('EXPENSE_RECEIPT');
    expect(() => resolveUploadPurpose('EXPENSE_RECEIPT', 'DISTRIBUTOR')).toThrow(AppError);
    expect(() => resolveUploadPurpose('DAY_END_UPLOAD', 'DISTRIBUTOR')).toThrow(AppError);
  });
});

describe('FilesService.upload (API_CONTRACT §5.8)', () => {
  it('stores the object and a stored_files row, and returns a URL signed for 1 hour', async () => {
    const { files, prisma, send } = service();
    const result = await files.upload({ buffer: PNG, originalname: 'C:\\fakepath\\slip.PNG' }, { actor: shop });
    expect(result.key).toMatch(/^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(result).toMatchObject({ mimeType: 'image/png', size: PNG.length });
    expect(result.url).toContain('X-Amz-Expires=3600');
    expect(result.url).toContain(result.key);
    expect(prisma.rows).toEqual([
      expect.objectContaining({
        id: result.fileId,
        storageKey: result.key,
        purpose: 'TOPUP_PROOF',
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        originalName: 'slip.PNG',
        uploadedByUserId: 'u-shop',
        distributorId: 'd-1',
      }),
    ]);
    const put = send.mock.calls.map((call) => call[0]).find((command) => command instanceof PutObjectCommand) as PutObjectCommand;
    expect(put.input).toMatchObject({ Bucket: 'sf-unit', Key: result.key, ContentType: 'image/png' });
  });

  it('refuses a renamed non-image with 415 FILE_TYPE_NOT_ALLOWED and stores nothing', async () => {
    const { files, prisma, send } = service();
    const error = await files.upload({ buffer: PDF, originalname: 'receipt.jpg' }, { actor: shop }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((error as AppError).getStatus()).toBe(415);
    expect(prisma.rows).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses more than 5 MB with 413 FILE_TOO_LARGE { maxMb: 5 }', async () => {
    const { files } = service();
    const big = Buffer.concat([JPEG, Buffer.alloc(UPLOAD_MAX_BYTES)]);
    const error = (await files.upload({ buffer: big }, { actor: shop }).catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe('FILE_TOO_LARGE');
    expect(error.getStatus()).toBe(413);
    expect(error.details).toEqual({ maxMb: 5 });
    expect(error.message).toBe('This file is too big. The limit is 5 MB.');
  });

  it('gives the same uploader the existing row for the same bytes and purpose', async () => {
    const { files, prisma, send } = service();
    const first = await files.upload({ buffer: JPEG }, { actor: driver });
    const second = await files.upload({ buffer: JPEG }, { actor: driver });
    expect(second.fileId).toBe(first.fileId);
    expect(prisma.rows).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    // Another uploader, or another purpose, stores its own copy.
    await files.upload({ buffer: JPEG }, { actor: office });
    await files.upload({ buffer: JPEG }, { actor: office, purpose: 'EXPENSE_RECEIPT' });
    expect(prisma.rows).toHaveLength(3);
  });

  it('answers 503 when object storage is down, before writing a row', async () => {
    const { files, prisma, send } = service();
    send.mockImplementationOnce((async () => Promise.reject(new Error('connect ECONNREFUSED'))) as never);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(await codeOf(files.upload({ buffer: WEBP }, { actor: shop }))).toBe('SERVICE_UNAVAILABLE');
    expect(prisma.rows).toHaveLength(0);
  });
});

describe('signed URLs and assertUsable', () => {
  it('signs for the uploader or the office only', async () => {
    const { files } = service();
    const { fileId } = await files.upload({ buffer: PNG }, { actor: shop });
    expect(await files.signedUrl(fileId, shop)).toContain('X-Amz-Expires=3600');
    expect(await files.signedUrl(fileId, office)).toContain('X-Amz-Signature=');
    expect(await codeOf(files.signedUrl(fileId, driver))).toBe('FILE_NOT_FOUND');
    expect(await codeOf(files.signedUrl('not-a-uuid', office))).toBe('FILE_NOT_FOUND');
  });

  it('checks purpose and uploader for linking services', async () => {
    const { files } = service();
    const { fileId, url } = await files.upload({ buffer: PNG }, { actor: shop });
    await expect(files.assertUsable(fileId, { purpose: 'TOPUP_PROOF', uploadedByUserId: 'u-shop' })).resolves.toMatchObject({
      id: fileId,
    });
    expect(await codeOf(files.assertUsable(fileId, { purpose: 'EXPENSE_RECEIPT' }))).toBe('FILE_NOT_FOUND');
    expect(await codeOf(files.assertUsable(fileId, { purpose: 'TOPUP_PROOF', uploadedByUserId: 'someone-else' }))).toBe(
      'FILE_NOT_FOUND',
    );
    expect(await codeOf(files.assertUsable('nope', { purpose: 'TOPUP_PROOF' }))).toBe('FILE_NOT_FOUND');
    // Installed apps send the URL they got back.
    await expect(files.assertUsableUrl(url, { purpose: 'TOPUP_PROOF', uploadedByUserId: 'u-shop' })).resolves.toMatchObject({
      id: fileId,
    });
    expect(await codeOf(files.assertUsableUrl('https://evil.example/x.png', { purpose: 'TOPUP_PROOF' }))).toBe('FILE_NOT_FOUND');
  });
});
