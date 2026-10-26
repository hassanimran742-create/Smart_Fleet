/**
 * FND-015, FND-016, FND-017: pictures are stored privately with their purpose and owner, refused by
 * content and size, and their links are signed for the uploader or the office only (API_CONTRACT
 * §5.8, §7.10, DATA_MODEL §3.3). Object storage is the API's real S3 client with `send` stubbed, so
 * URLs are signed for real and no bucket is needed.
 */
import type { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import { FilesService } from '../../src/modules/files/files.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';

const MB5 = 5 * 1024 * 1024;

/** A buffer of `size` bytes starting with `magic`. */
function fileOf(magic: Buffer | string, size: number, fill = 0x41): Buffer {
  const head = typeof magic === 'string' ? Buffer.from(magic, 'latin1') : magic;
  const buffer = Buffer.alloc(size, fill);
  head.copy(buffer, 0, 0, Math.min(head.length, size));
  return buffer;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ', 'latin1')]);

const proofJpg = fileOf(JPEG, 204_800);
const proofPng = fileOf(PNG, 4_096);
const proofWebp = fileOf(WEBP, 4_096);

describeDb('foundation: files', () => {
  let app: INestApplication;
  let std: StandardData;
  let send: jest.SpyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
    const s3 = (app.get(FilesService) as unknown as { s3: { send: (command: unknown) => Promise<unknown> } }).s3;
    send = jest.spyOn(s3, 'send').mockImplementation(async () => ({}));
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => client(app);
  const db = () => getTestPrisma();
  const puts = () => send.mock.calls.filter(([command]) => (command as { constructor: { name: string } }).constructor.name === 'PutObjectCommand').length;

  function upload(actor: { actor: Parameters<typeof authHeader>[0] }, file: Buffer, name: string, opts: { purpose?: string; contentType?: string } = {}) {
    const req = http().post('/api/v1/files/upload').set(authHeader(actor.actor));
    if (opts.purpose) req.field('purpose', opts.purpose);
    return req.attach('file', file, { filename: name, contentType: opts.contentType ?? 'image/jpeg' });
  }

  let f1 = '';

  it('FND-015 picture uploads are stored privately with the right purpose and owner', async () => {
    const day = new Date().toISOString().slice(0, 10);
    // Step 1.
    const first = await upload(std.DA, proofJpg, 'proof.jpg').expect(201);
    expect(first.body).toMatchObject({ mimeType: 'image/jpeg', size: 204_800 });
    expect(first.body.key).toMatch(new RegExp(`^uploads/${day}/[0-9a-f-]{36}\\.jpg$`));
    expect(first.body.url).toContain('X-Amz-Expires=3600');
    f1 = first.body.fileId;
    const row = await db().storedFile.findUniqueOrThrow({ where: { id: f1 } });
    expect(row).toMatchObject({
      purpose: 'TOPUP_PROOF',
      uploadedByUserId: std.DA.userId,
      distributorId: std.DA.id,
      sha256: createHash('sha256').update(proofJpg).digest('hex'),
      sizeBytes: 204_800,
      storageKey: first.body.key,
    });
    // Step 2: same uploader, same bytes, same purpose → the existing row.
    const rows = await db().storedFile.count();
    const again = await upload(std.DA, proofJpg, 'proof.jpg').expect(201);
    expect(again.body.fileId).toBe(f1);
    expect(await db().storedFile.count()).toBe(rows);
    // Step 3.
    expect((await upload(std.DA, proofPng, 'proof.png', { contentType: 'image/png' }).expect(201)).body.mimeType).toBe('image/png');
    expect((await upload(std.DA, proofWebp, 'proof.webp', { contentType: 'image/webp' }).expect(201)).body.mimeType).toBe('image/webp');
    // Step 4: a driver's upload is OTHER, with no distributor.
    const driver = await upload(std.DR1, proofJpg, 'proof.jpg').expect(201);
    expect(driver.body.fileId).not.toBe(f1);
    expect(await db().storedFile.findUniqueOrThrow({ where: { id: driver.body.fileId } })).toMatchObject({
      purpose: 'OTHER',
      distributorId: null,
      uploadedByUserId: std.DR1.userId,
    });
    // Step 5: EXPENSE_RECEIPT is office only.
    const before = await db().storedFile.count();
    const refused = await upload(std.DA, proofJpg, 'proof.jpg', { purpose: 'EXPENSE_RECEIPT' }).expect(403);
    expect(refused.body.code).toBe('PERMISSION_DENIED');
    expect(await db().storedFile.count()).toBe(before);
    // Step 6.
    const office = await upload(std.SA1, proofJpg, 'proof.jpg', { purpose: 'EXPENSE_RECEIPT' }).expect(201);
    expect((await db().storedFile.findUniqueOrThrow({ where: { id: office.body.fileId } })).purpose).toBe('EXPENSE_RECEIPT');
  });

  it('FND-016 uploads refuse non-pictures by their content, and files over 5 MB', async () => {
    const rowsBefore = await db().storedFile.count();
    const putsBefore = puts();
    const refusals: [Buffer, string, string][] = [
      [fileOf('%PDF-1.7\n', 2_048), 'proof.jpg', 'image/jpeg'],
      [fileOf('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 512), 'proof.svg', 'image/svg+xml'],
      [fileOf('GIF89a', 1_024), 'proof.gif', 'image/gif'],
      [fileOf('<!doctype html><html></html>', 512), 'proof.png', 'image/png'],
    ];
    for (const [file, name, contentType] of refusals) {
      const res = await upload(std.DA, file, name, { contentType }).expect(415);
      expect(res.body).toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', message: 'Use a JPG, PNG or WebP picture.' });
    }
    expect(await db().storedFile.count()).toBe(rowsBefore);
    expect(puts()).toBe(putsBefore);
    // Step 3: exactly 5 MB is allowed.
    await upload(std.DA, fileOf(JPEG, MB5, 0x42), 'big.jpg').expect(201);
    // Step 4: one byte more is 413.
    const tooBig = await upload(std.DA, fileOf(JPEG, MB5 + 1, 0x43), 'bigger.jpg').expect(413);
    expect(tooBig.body).toMatchObject({ code: 'FILE_TOO_LARGE', details: { maxMb: 5 }, message: 'This file is too big. The limit is 5 MB.' });
    // Step 5: an empty file is not a picture.
    const rows = await db().storedFile.count();
    const empty = await upload(std.DA, Buffer.alloc(0), 'proof.jpg').expect(415);
    expect(empty.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await db().storedFile.count()).toBe(rows);
  });

  it("FND-017 only the uploader or the office can get a file's link", async () => {
    expect(f1).not.toBe('');
    // Steps 1–2.
    for (const person of [std.DA, std.SA1]) {
      const res = await http().get(`/api/v1/files/${f1}/url`).set(authHeader(person.actor)).expect(200);
      expect(res.body.url).toContain('X-Amz-Expires=3600');
    }
    // Steps 3–4: someone else's file and an unknown id look the same.
    const strip = (body: Record<string, unknown>) => {
      const { requestId: _r, timestamp: _t, path: _p, ...rest } = body;
      return rest;
    };
    const bodies = [];
    for (const [person, id] of [
      [std.DB, f1],
      [std.DR1, f1],
      [std.DB, '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7'],
    ] as const) {
      const res = await http().get(`/api/v1/files/${id}/url`).set(authHeader(person.actor)).expect(404);
      expect(res.body).toMatchObject({ code: 'FILE_NOT_FOUND', message: "We couldn't find this file. Upload it again." });
      bodies.push(strip(res.body));
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });
});
