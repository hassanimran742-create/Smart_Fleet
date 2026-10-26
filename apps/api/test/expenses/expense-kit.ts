/**
 * Shared set-up for the expenses suites (API_CONTRACT §7.12): the API with a fixed clock for the
 * expenses module (its "today" in Asia/Karachi), object storage stubbed for receipt uploads, the seeded
 * expense types by code, and small request helpers. Not a test file itself.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { ExpensesClock } from '../../src/modules/expenses/expenses.clock';
import { FilesService } from '../../src/modules/files/files.service';
import { createTestApp, forgetSettings } from '../helpers/app';
import { authHeader, type TestActor } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { http, type TestRequest } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';

/** For the hooks that boot the whole API: a cold run transpiles every module first. */
export const BOOT_TIMEOUT_MS = 180_000;

/** Noon on Thu 22 Oct 2026 in Asia/Karachi (07:00 UTC): "today" in most cases. */
export const PKT_OCT_22_NOON = '2026-10-22T07:00:00.000Z';
export const OCT_22 = '2026-10-22';

/** The clock ExpensesService and ExpenseTypesService read, moved by the test. */
export class FixedClock {
  private at: number;

  constructor(iso: string = PKT_OCT_22_NOON) {
    this.at = Date.parse(iso);
  }

  set(iso: string): void {
    this.at = Date.parse(iso);
  }

  now(): Date {
    return new Date(this.at);
  }
}

export interface ExpensesApp {
  app: INestApplication;
  clock: FixedClock;
  /** The stubbed S3 `send` (uploads succeed without a bucket; URLs are still signed for real). */
  s3Send: jest.SpyInstance;
}

/** AppModule with the expenses clock fixed and object storage stubbed. */
export async function createExpensesApp(clock = new FixedClock()): Promise<ExpensesApp> {
  const app = await createTestApp((builder) => builder.overrideProvider(ExpensesClock).useValue(clock));
  const s3 = (app.get(FilesService) as unknown as { s3: { send: (command: unknown) => Promise<unknown> } }).s3;
  const s3Send = jest.spyOn(s3, 'send').mockImplementation(async () => ({}));
  return { app, clock, s3Send };
}

/** A clean database with the standard data (TEST_CASES.md), and a fresh settings cache. */
export async function freshStandardData(app: INestApplication): Promise<StandardData> {
  await resetDb();
  forgetSettings(app);
  return createStandardData();
}

/** Expense type ids by code (custom types by name). */
export async function typeIds(): Promise<Record<string, string>> {
  const rows = await getTestPrisma().expenseType.findMany({ select: { id: true, code: true, name: true } });
  return Object.fromEntries(rows.map((row) => [row.code ?? row.name, row.id]));
}

/** Request helpers for the expenses routes, each signed as `actor`. */
export function expensesApi(app: INestApplication) {
  const client = http(app);
  const as = (request: TestRequest, actor: TestActor) => request.set(authHeader(actor));
  return {
    createExpense: (actor: TestActor, body: Record<string, unknown>, key: string | null = randomUUID()) => {
      const request = as(client.post('/api/v1/expenses'), actor);
      return (key ? request.set('Idempotency-Key', key) : request).send(body);
    },
    updateExpense: (actor: TestActor, id: string, body: Record<string, unknown>) =>
      as(client.patch(`/api/v1/expenses/${id}`), actor).send(body),
    voidExpense: (actor: TestActor, id: string, reason: string) =>
      as(client.post(`/api/v1/expenses/${id}/void`), actor).send({ reason }),
    listExpenses: (actor: TestActor, query: Record<string, string | number | boolean> = {}) =>
      as(client.get('/api/v1/expenses'), actor).query(query),
    summary: (actor: TestActor, query: Record<string, string> = {}) =>
      as(client.get('/api/v1/expenses/summary'), actor).query(query),
    listTypes: (actor: TestActor, includeArchived = false) =>
      as(client.get('/api/v1/expense-types'), actor).query(includeArchived ? { includeArchived: 'true' } : {}),
    createType: (actor: TestActor, name: string) => as(client.post('/api/v1/expense-types'), actor).send({ name }),
    renameType: (actor: TestActor, id: string, name: string) =>
      as(client.patch(`/api/v1/expense-types/${id}`), actor).send({ name }),
    archiveType: (actor: TestActor, id: string) => as(client.post(`/api/v1/expense-types/${id}/archive`), actor).send({}),
    restoreType: (actor: TestActor, id: string) => as(client.post(`/api/v1/expense-types/${id}/restore`), actor).send({}),
    auditLogs: (actor: TestActor, query: Record<string, string>) => as(client.get('/api/v1/audit-logs'), actor).query(query),
  };
}

/** Rows of `GET /audit-logs`, all pages, oldest first. */
export async function auditRows(app: INestApplication, actor: TestActor, query: Record<string, string>) {
  const api = expensesApi(app);
  const rows: Array<Record<string, any>> = [];
  let cursor: string | null = null;
  do {
    const page: Record<string, string> = { ...query, limit: '100' };
    if (cursor) page.cursor = cursor;
    const res = await api.auditLogs(actor, page).expect(200);
    rows.push(...res.body.items);
    cursor = res.body.nextCursor;
  } while (cursor);
  return rows.reverse();
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A buffer of `size` bytes starting with `magic`, filled with `fill` (so two files can differ). */
export function fileOf(magic: Buffer | string, size: number, fill = 0x41): Buffer {
  const head = typeof magic === 'string' ? Buffer.from(magic, 'latin1') : magic;
  const buffer = Buffer.alloc(size, fill);
  head.copy(buffer, 0, 0, Math.min(head.length, size));
  return buffer;
}

export const jpegOf = (size: number, fill = 0x41) => fileOf(JPEG_MAGIC, size, fill);
export const pngOf = (size: number, fill = 0x41) => fileOf(PNG_MAGIC, size, fill);

/** `POST /files/upload` as `actor` (multipart; the purpose goes first, as the website sends it). */
export function upload(
  app: INestApplication,
  actor: TestActor,
  file: Buffer,
  opts: { filename: string; contentType: string; purpose?: string },
) {
  const request = http(app).post('/api/v1/files/upload').set(authHeader(actor));
  if (opts.purpose) request.field('purpose', opts.purpose);
  return request.attach('file', file, { filename: opts.filename, contentType: opts.contentType });
}

/** Strips the per-request fields of an error envelope, to compare two refusals. */
export function envelopeOf(body: Record<string, unknown>): Record<string, unknown> {
  const { requestId: _requestId, timestamp: _timestamp, path: _path, ...rest } = body;
  return rest;
}
