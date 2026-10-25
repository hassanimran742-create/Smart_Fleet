/**
 * [review23 verify holder-money] money-data-01 over HTTP: the shop's real day-end sheet, filled normally,
 * with its two "Your count" dropdowns filled down to the end of the column (E2:E1048576, F2:F1048576, as
 * Excel saves a validation pasted down a whole column). The upload is a normal POST /day-end/:date/upload
 * by the shop. A /health/live probe sent from another process (its own event loop) while the upload is
 * being read shows whether the API stops answering everyone.
 *
 * Before the fix exceljs expanded the ranges and the API answered nobody for seconds. Lead decision 2: the
 * shape check refuses a range past row 20,000 before exceljs reads anything (422 DAY_SHEET_UNREADABLE,
 * API_CONTRACT §10.5), so the probe is answered at once.
 */
import { spawn } from 'child_process';
import type { AddressInfo } from 'net';
import type { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import { describeDb } from '../../helpers/describe-db';
import { API, BOOT_TIMEOUT_MS, CASE_TIMEOUT_MS, createDayEndApp, download, fill, freshWorld, upload, type DayWorld } from '../../inc3/dayend/support';

jest.setTimeout(CASE_TIMEOUT_MS);

async function filledDown(sheet: Buffer): Promise<{ file: Buffer; patched: number }> {
  const zip = await JSZip.loadAsync(sheet);
  let patched = 0;
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async('string');
    const next = xml.replace(/sqref="([EF])2:\1\d+"/g, (_m, col: string) => {
      patched++;
      return `sqref="${col}2:${col}1048576"`;
    });
    zip.file(name, next);
  }
  return { file: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), patched };
}

/** A /health/live probe from another process, sent `delayMs` after that process starts. */
function probeFromChild(port: number, delayMs: number): Promise<{ status: number; ms: number }> {
  const script =
    `const http=require('http');setTimeout(()=>{const t=Date.now();` +
    `http.get({host:'127.0.0.1',port:${port},path:'${API}/health/live'},(r)=>{r.resume();r.on('end',()=>{process.stdout.write(JSON.stringify({status:r.statusCode,ms:Date.now()-t}));});})` +
    `.on('error',(e)=>{process.stdout.write(JSON.stringify({status:0,ms:Date.now()-t,error:e.message}));});},${delayMs});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', () => resolve(JSON.parse(out || '{"status":-1,"ms":-1}')));
  });
}

async function timedUploadWithProbe(app: INestApplication, w: DayWorld, file: Buffer) {
  const port = (app.getHttpServer().address() as AddressInfo).port;
  // The child needs ~100-300 ms to start, then waits 500 ms: its probe lands while the upload is being read.
  const probe = probeFromChild(port, 500);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const started = Date.now();
  const res = await upload(w, file);
  const up = { status: res.status, code: res.body?.code, ms: Date.now() - started };
  return { upload: up, probe: await probe };
}

describeDb('review23 verify: a filled-down dropdown no longer blocks the API during the day-end upload', () => {
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

  it('REV23 money-data-01 a normal upload, then the same sheet with E and F filled down: refused at once, and the health probe never waits', async () => {
    const sheet = await fill(await download(w), {});
    const normal = await timedUploadWithProbe(app, w, sheet);
    const { file, patched } = await filledDown(sheet);
    const hostile = await timedUploadWithProbe(app, w, file);
    // eslint-disable-next-line no-console
    console.log(`[verify-money-01] patched ${patched} ranges, ${file.length} B; normal ${JSON.stringify(normal)}; filled-down ${JSON.stringify(hostile)}`);
    expect(patched).toBe(2);
    expect(file.length).toBeLessThan(64 * 1024);
    expect(normal.upload.status).toBe(200);
    expect(normal.probe.ms).toBeLessThan(500);
    // Refused by the shape check before exceljs runs: the existing upload error, nothing saved.
    expect({ status: hostile.upload.status, code: hostile.upload.code }).toEqual({ status: 422, code: 'DAY_SHEET_UNREADABLE' });
    expect(hostile.upload.ms).toBeLessThan(1_000);
    expect(hostile.probe.status).toBe(200);
    expect(hostile.probe.ms).toBeLessThan(500); // everyone else is still answered
  });
});
