/**
 * Review 23 (security): the day-end upload's zip-bomb caps (API_CONTRACT §10.2 check 3: at most 2 MiB, at
 * most 20 MB unzipped, at most 20,000 rows a sheet) still let a ~110 KB file make exceljs parse ~18 MB of
 * sheet XML in the request, before the "About" check, with no rate limit on the route. The single API
 * process (ADR-23) then answers nothing else for seconds: the probe below measures `GET /health/live`
 * while one upload runs.
 *
 * Expected by this test (the fix): an upload the server will refuse anyway never stalls other requests
 * for more than a second. Today it stalls them for ~8–10 s per upload.
 */
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { DAY_SHEET_LIMITS, ERROR_MESSAGE_EN } from '@smartfleet/shared-types';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { DAY_END_BUSY_RETRY_AFTER_SECONDS } from '../../../src/modules/day-end/day-end.controller';
import { dayEndReadGate } from '../../../src/modules/day-end/day-end-upload-read';
import * as dayEndWorkbook from '../../../src/modules/day-end/day-end-workbook';
import { inspectZip } from '../../../src/modules/day-end/day-end-zip';
import { BOOT_TIMEOUT_MS, createDayEndApp, D21, download, fill, freshWorld, upload, type DayWorld } from '../../inc3/dayend/support';

jest.setTimeout(300_000);

/** An .xlsx of 19,999 rows × `cols` tiny cells: ~110 KB zipped, ~18 MB unzipped. */
async function heavySheet(cols: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Cylinders').addRow(['x']);
  wb.addWorksheet('Extra cylinders').addRow(['x']);
  wb.addWorksheet('About').addRow(['format', 'smart-fleet-day-end/1']);
  const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
  const rowCells = '<c><v>1</v></c>'.repeat(cols);
  const parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  for (let r = 1; r < DAY_SHEET_LIMITS.maxRowsPerSheet; r++) parts.push(`<row r="${r}">${rowCells}</row>`);
  parts.push('</sheetData></worksheet>');
  zip.file('xl/worksheets/sheet1.xml', parts.join(''));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

/**
 * Polls `GET /health/live` every 50 ms until `done` settles. Returns the longest stretch with no answer at
 * all (between two answers, wherever the stall fell: during a probe or during the 50 ms pause), in ms.
 */
async function probeWhile(app: INestApplication, done: Promise<unknown>): Promise<{ maxMs: number; probes: number }> {
  let finished = false;
  void done.finally(() => {
    finished = true;
  });
  let maxMs = 0;
  let probes = 0;
  let lastAnswer = Date.now();
  while (!finished) {
    await http(app).get('/api/v1/health/live').expect(200);
    const now = Date.now();
    maxMs = Math.max(maxMs, now - lastAnswer);
    lastAnswer = now;
    probes += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { maxMs, probes };
}

describeDb('review23 security: a heavy day-end upload stalls the whole API', () => {
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

  it('REV23-SEC-DAYEND-DOS one ~110 KB upload that passes every size cap blocks every other request for seconds', async () => {
    const file = await heavySheet(60);
    // The file is inside every cap the contract sets, so check 3 hands it to exceljs.
    expect(file.length).toBeLessThan(DAY_SHEET_LIMITS.maxBytes);
    const zip = inspectZip(file, { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes });
    expect(zip).toMatchObject({ ok: true });

    const heapBefore = process.memoryUsage().heapUsed;
    let heapPeak = heapBefore;
    const sampler = setInterval(() => {
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }, 25);

    const started = Date.now();
    const sent = Promise.resolve(upload(w, file, D21));
    const probe = await probeWhile(app, sent);
    const res = await sent;
    const uploadMs = Date.now() - started;
    clearInterval(sampler);

    // eslint-disable-next-line no-console
    console.log(
      `[review23] heavy upload: ${file.length} bytes, ${zip.ok ? zip.unzippedBytes : 0} unzipped; answered ${res.status} ${res.body?.code} ` +
        `in ${uploadMs} ms; slowest /health/live meanwhile ${probe.maxMs} ms over ${probe.probes} probes; heap +${Math.round((heapPeak - heapBefore) / 1e6)} MB`,
    );
    // The upload is refused (it isn't the day-end sheet)...
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DAY_SHEET_UNREADABLE');
    // ...but while the server read it, nobody else (drivers' scans, the customer page, the office) got an answer.
    expect(probe.maxMs).toBeLessThan(1_000);
  });

  it('REV23-SEC-DAYEND-DOS three such uploads at once (no rate limit) hold hundreds of MB of heap', async () => {
    const file = await heavyValidSheet(34);
    expect(file.length).toBeLessThan(DAY_SHEET_LIMITS.maxBytes);
    expect(inspectZip(file, { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes })).toMatchObject({ ok: true });

    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    let heapPeak = heapBefore;
    const sampler = setInterval(() => {
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }, 25);
    const started = Date.now();
    const all = Promise.all([upload(w, file, D21), upload(w, file, D21), upload(w, file, D21)].map((req) => Promise.resolve(req)));
    const probe = await probeWhile(app, all);
    const answers = await all;
    clearInterval(sampler);
    const grownMb = Math.round((heapPeak - heapBefore) / 1e6);
    // eslint-disable-next-line no-console
    console.log(
      `[review23] 3 parallel uploads of ${file.length} bytes: answered ${answers.map((res) => `${res.status} ${res.body?.code}`).join(', ')} ` +
        `in ${Date.now() - started} ms; slowest /health/live ${probe.maxMs} ms; heap +${grownMb} MB at the peak`,
    );
    for (const res of answers) expect(res.status).toBe(422);
    // A refused day-end sheet should cost the server a few MB, not a pilot instance's whole memory.
    expect(grownMb).toBeLessThan(100);
  });

  it('REV23 security-02 three uploads at once of a sheet inside every limit are read one at a time', async () => {
    // The shop's own newest sheet (so the About checks pass) grown to the documented maximum: 19,999 rows.
    const big = await fill(await download(w), {}, {
      edit: (book) => {
        const main = book.getWorksheet('Cylinders') as ExcelJS.Worksheet;
        for (let r = main.rowCount + 1; r <= DAY_SHEET_LIMITS.maxRowsPerSheet; r++) {
          main.getRow(r).values = [`AG-C${String(r).padStart(5, '0')}`, '11.8 kg', 'In my store', 'Full', 'In my store', 'Empty', 'Counted in the evening'];
        }
      },
    });
    expect(big.length).toBeLessThan(DAY_SHEET_LIMITS.maxBytes);

    // Count how many workbooks are being read at the same moment.
    const original = dayEndWorkbook.loadDayWorkbook;
    let reading = 0;
    let most = 0;
    const spy = jest.spyOn(dayEndWorkbook, 'loadDayWorkbook').mockImplementation(async (...args) => {
      reading += 1;
      most = Math.max(most, reading);
      try {
        return await original(...args);
      } finally {
        reading -= 1;
      }
    });
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    let heapPeak = heapBefore;
    const sampler = setInterval(() => {
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }, 25);
    try {
      const all = Promise.all([upload(w, big, D21), upload(w, big, D21), upload(w, big, D21)].map((req) => Promise.resolve(req)));
      const probe = await probeWhile(app, all);
      const answers = await all;
      const grownMb = Math.round((heapPeak - heapBefore) / 1e6);
      // eslint-disable-next-line no-console
      console.log(
        `[review23] 3 uploads at once of a ${big.length}-byte, 19,999-row sheet: ${answers.map((res) => `${res.status} ${res.body?.code}`).join(', ')}; ` +
          `at most ${most} read at once; slowest /health/live ${probe.maxMs} ms; heap +${grownMb} MB at the peak`,
      );
      // Every row is a number the shop doesn't have, so each is read in full and refused on its rows; the
      // other two waited their turn (a waiting upload holds only its own body).
      for (const res of answers) expect({ status: res.status, code: res.body.code }).toEqual({ status: 422, code: 'DAY_SHEET_ROW_ERRORS' });
      expect(most).toBe(1);
      expect(grownMb).toBeLessThan(300);
    } finally {
      clearInterval(sampler);
      spy.mockRestore();
    }
  });

  it('REV23 security-02 while a file is read and two wait, another upload is answered 503 with Retry-After', async () => {
    const sheet = await fill(await download(w), {});
    let release: () => void = () => undefined;
    // Hold the process's one read slot, as a long read would.
    const held = dayEndReadGate.run(() => new Promise<void>((resolve) => (release = resolve)));
    try {
      const waiting = [upload(w, sheet, D21), upload(w, sheet, D21)].map((req) => Promise.resolve(req));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const busy = await upload(w, sheet, D21);
      expect({ status: busy.status, code: busy.body.code, message: busy.body.message, retryAfter: busy.headers['retry-after'] }).toEqual({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: ERROR_MESSAGE_EN.SERVICE_UNAVAILABLE,
        retryAfter: String(DAY_END_BUSY_RETRY_AFTER_SECONDS),
      });
      release();
      // The two that waited are read in turn: the first is stored, the second finds the same sheet again.
      const answers = await Promise.all(waiting);
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
    } finally {
      release();
      await held;
    }
  });

  it('REV23 security-02 a shop login may send at most 20 uploads in 10 minutes', async () => {
    const notASheet = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await upload(w, notASheet, D21)).status);
    expect(new Set(statuses)).toEqual(new Set([422]));
    const limited = await upload(w, notASheet, D21);
    expect({ status: limited.status, code: limited.body.code }).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // The other shop is counted on its own.
    expect((await upload(w, notASheet, D21, 'DB')).status).toBe(422);
  });
});

/** The same shape with real cell references (`<c r="AB123">`), so exceljs loads it as a workbook: ~1.8 MB zipped. */
async function heavyValidSheet(cols: number): Promise<Buffer> {
  const colName = (n: number): string => {
    let s = '';
    let k = n + 1;
    while (k > 0) {
      const m = (k - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      k = Math.floor((k - 1) / 26);
    }
    return s;
  };
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Cylinders').addRow(['x']);
  wb.addWorksheet('Extra cylinders').addRow(['x']);
  wb.addWorksheet('About').addRow(['format', 'smart-fleet-day-end/1']);
  const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
  const parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  for (let r = 1; r < DAY_SHEET_LIMITS.maxRowsPerSheet; r++) {
    let cells = '';
    for (let c = 0; c < cols; c++) cells += `<c r="${colName(c)}${r}"><v>1</v></c>`;
    parts.push(`<row r="${r}">${cells}</row>`);
  }
  parts.push('</sheetData></worksheet>');
  zip.file('xl/worksheets/sheet1.xml', parts.join(''));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
