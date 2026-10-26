/**
 * EXP-007: receipt photos are JPG, PNG or WebP up to 5 MB, uploaded by the office as an expense receipt,
 * and an expense links only such a file (API_CONTRACT §7.10, §7.12, §5.8, §2.3). Object storage is the
 * real S3 client with `send` stubbed, so URLs are signed for real and no bucket is needed.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import type { StandardData } from '../helpers/standard-data';
import {
  BOOT_TIMEOUT_MS,
  createExpensesApp,
  envelopeOf,
  expensesApi,
  fileOf,
  freshStandardData,
  jpegOf,
  OCT_22,
  pngOf,
  typeIds,
  upload,
} from './expense-kit';

const MB = 1024 * 1024;

describeDb('expenses: receipt photos', () => {
  let app: INestApplication;
  let std: StandardData;
  let types: Record<string, string>;

  beforeAll(async () => {
    ({ app } = await createExpensesApp());
    std = await freshStandardData(app);
    types = await typeIds();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  const db = () => getTestPrisma();
  const receipt = (actor: StandardData['SA1']['actor'], file: Buffer, filename: string, contentType: string, purpose = 'EXPENSE_RECEIPT') =>
    upload(app, actor, file, { filename, contentType, purpose });
  const expense = (receiptFileId: string) =>
    expensesApi(app).createExpense(std.SA1.actor, {
      expenseDate: OCT_22,
      amountPaisa: '150000',
      typeId: types.REPAIRS,
      description: 'Brake pads',
      receiptFileId,
    });

  it('EXP-007 receipt photos: JPG, PNG or WebP up to 5 MB, uploaded by the office as an expense receipt', async () => {
    const big = jpegOf(Math.round(4.9 * MB), 0x44);
    const tooBig = jpegOf(Math.round(5.1 * MB), 0x45);
    const png = pngOf(8_192, 0x46);
    const pdf = fileOf('%PDF-1.7\n', 4_096);
    const textAsJpg = fileOf('Receipt from the tyre shop, paid in cash.\n', 2_048);

    // Step 1.
    const first = await receipt(std.SA1.actor, big, 'receipt.jpg', 'image/jpeg').expect(201);
    expect(first.body).toEqual({
      fileId: expect.any(String),
      key: expect.stringMatching(/^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.jpg$/),
      url: expect.stringContaining('X-Amz-Expires=3600'),
      mimeType: 'image/jpeg',
      size: Math.round(4.9 * MB),
    });
    const pngRes = await receipt(std.SA1.actor, png, 'receipt.png', 'image/png').expect(201);
    expect(pngRes.body).toMatchObject({ mimeType: 'image/png', size: 8_192 });
    const over = await receipt(std.SA1.actor, tooBig, 'big.jpg', 'image/jpeg').expect(413);
    expect(over.body).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'This file is too big. The limit is 5 MB.' });
    for (const [file, name, type] of [
      [pdf, 'receipt.pdf', 'application/pdf'],
      [textAsJpg, 'receipt.jpg', 'image/jpeg'],
    ] as const) {
      const refused = await receipt(std.SA1.actor, file, name, type).expect(415);
      expect(refused.body).toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', message: 'Use a JPG, PNG or WebP picture.' });
    }
    const stored = await db().storedFile.findMany({ where: { uploadedByUserId: std.SA1.id } });
    expect(stored.map((file) => file.purpose)).toEqual(['EXPENSE_RECEIPT', 'EXPENSE_RECEIPT']);

    // Step 2: the same uploader and bytes give the same file.
    const again = await receipt(std.SA1.actor, big, 'receipt-again.jpg', 'image/jpeg').expect(201);
    expect(again.body.fileId).toBe(first.body.fileId);
    expect(await db().storedFile.count({ where: { uploadedByUserId: std.SA1.id } })).toBe(2);

    // Step 3: expense receipts are office only.
    const shop = await receipt(std.DA.actor, png, 'receipt.png', 'image/png').expect(403);
    expect(shop.body.code).toBe('PERMISSION_DENIED');

    // Step 4: a top-up proof can't be an expense receipt.
    const proof = await receipt(std.DA.actor, png, 'proof.png', 'image/png', 'TOPUP_PROOF').expect(201);
    const wrongPurpose = await expense(proof.body.fileId).expect(404);
    expect(wrongPurpose.body).toMatchObject({ code: 'FILE_NOT_FOUND', message: "We couldn't find this file. Upload it again." });

    // Step 5: an unknown file looks the same.
    const unknown = await expense(randomUUID()).expect(404);
    expect(envelopeOf(unknown.body)).toEqual(envelopeOf(wrongPurpose.body));
    expect(await db().expense.count()).toBe(0);

    // An office receipt is linked, and the expense carries a fresh signed URL for it.
    const linked = await expense(first.body.fileId).expect(201);
    expect(linked.body.receiptFileId).toBe(first.body.fileId);
    expect(linked.body.receiptUrl).toContain(first.body.key);
  });
});
