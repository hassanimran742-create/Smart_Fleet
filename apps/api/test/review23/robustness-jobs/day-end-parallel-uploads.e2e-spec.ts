/**
 * REV23 robustness-jobs-01: three day-end uploads at once of a workbook inside every byte limit the contract
 * used to set (≤ 2 MiB, ≤ 20 MB unzipped, ≤ 20,000 rows) but with 1,001 rows × 700 cells on "Cylinders" used to
 * take about 230 MB of heap each and crash the one API instance (ADR-23) with "JavaScript heap out of memory".
 * Now the shape check refuses the workbook before exceljs reads it (at most 200,000 cells, API_CONTRACT §10.5),
 * and files are read one at a time: three at once are answered 422 DAY_SHEET_UNREADABLE in moments, the heap
 * barely moves and every other request keeps being answered.
 */
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { DAY_SHEET_LIMITS } from '@smartfleet/shared-types';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { inspectZip } from '../../../src/modules/day-end/day-end-zip';
import { BOOT_TIMEOUT_MS, createDayEndApp, D21, freshWorld, upload, type DayWorld } from '../../inc3/dayend/support';

jest.setTimeout(300_000);

const columnName = (n: number): string => {
  let name = '';
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) name = String.fromCharCode(65 + ((k - 1) % 26)) + name;
  return name;
};

/** The reviewer's workbook (probes/wide-sheet3.mjs 1000 700): About holds only the format line. */
async function wideSheet(rows: number, perRow: number): Promise<{ file: Buffer; unzipped: number }> {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Cylinders').addRow(['Cylinder number', 'Size', 'App says: where', 'App says: state', 'Your count: where', 'Your count: state', 'Why different']);
  book.addWorksheet('Extra cylinders').addRow(['Cylinder number', 'Size', 'State']);
  book.addWorksheet('About').addRow(['format', 'smart-fleet-day-end/1']);
  const zip = await JSZip.loadAsync(Buffer.from(await book.xlsx.writeBuffer()));
  const part = 'xl/worksheets/sheet1.xml';
  const xml = await zip.file(part)!.async('string');
  const columns = Array.from({ length: perRow }, (_, i) => columnName(i));
  const body: string[] = [];
  for (let r = 2; r <= rows + 1; r++) body.push(`<row r="${r}">${columns.map((c) => `<c r="${c}${r}"><v>1</v></c>`).join('')}</row>`);
  zip.file(part, xml.replace('</sheetData>', `${body.join('')}</sheetData>`));
  const file = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  let unzipped = 0;
  for (const entry of Object.values(zip.files)) if (!entry.dir) unzipped += (await entry.async('nodebuffer')).length;
  return { file, unzipped };
}

/** The longest stretch with no answer from `GET /health/live`, polled every 50 ms until `done` settles. */
async function probeWhile(app: INestApplication, done: Promise<unknown>): Promise<number> {
  let finished = false;
  void done.finally(() => (finished = true));
  let longest = 0;
  let last = Date.now();
  while (!finished) {
    await http(app).get('/api/v1/health/live').expect(200);
    const now = Date.now();
    longest = Math.max(longest, now - last);
    last = now;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return longest;
}

describeDb('REV23 robustness-jobs-01 three day-end uploads at once', () => {
  let app: INestApplication;
  let w: DayWorld;

  beforeAll(async () => {
    app = await createDayEndApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    w = await freshWorld(app);
  });

  it('REV23 robustness-jobs-01 a 1,001 × 700-cell workbook sent three times at once is refused at once; the API stays up', async () => {
    const { file, unzipped } = await wideSheet(1_000, 700);
    // Inside every byte and row limit: the old checks handed it to exceljs.
    expect(file.length).toBeLessThan(DAY_SHEET_LIMITS.maxBytes);
    expect(unzipped).toBeLessThan(DAY_SHEET_LIMITS.maxUnzippedBytes);
    expect(inspectZip(file, { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes })).toMatchObject({ ok: true });

    const heapBefore = process.memoryUsage().heapUsed;
    let heapPeak = heapBefore;
    const sampler = setInterval(() => (heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed)), 25);
    const started = Date.now();
    try {
      // Two shops' phones and a retry, as the reviewer's probe sends them.
      const all = Promise.all([upload(w, file, D21, 'DA'), upload(w, file, D21, 'DB'), upload(w, file, D21, 'DA')].map((req) => Promise.resolve(req)));
      const longest = await probeWhile(app, all);
      const answers = await all;
      const ms = Date.now() - started;
      const grownMb = Math.round((heapPeak - heapBefore) / 1e6);
      // eslint-disable-next-line no-console
      console.log(
        `[review23] 3 uploads at once of ${file.length} bytes (${unzipped} unzipped): ${answers.map((res) => `${res.status} ${res.body?.code}`).join(', ')} ` +
          `in ${ms} ms; slowest /health/live ${longest} ms; heap +${grownMb} MB at the peak`,
      );
      for (const res of answers) expect({ status: res.status, code: res.body.code }).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });
      expect(ms).toBeLessThan(10_000);
      expect(longest).toBeLessThan(1_000);
      expect(grownMb).toBeLessThan(100);
    } finally {
      clearInterval(sampler);
    }
    // And the API answers as before.
    await http(app).get('/api/v1/health/live').expect(200);
  });
});
