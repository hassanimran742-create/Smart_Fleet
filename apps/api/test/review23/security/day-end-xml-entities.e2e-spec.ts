/**
 * Review 23 (security): XML entities in an uploaded day-end sheet (XXE, "billion laughs"). These pass on
 * today's code: exceljs 4.4.0 reads the parts with saxes 5, which refuses every entity a DOCTYPE declares
 * ("undefined entity"), so the upload is 422 DAY_SHEET_UNREADABLE at once and no file is read or stored.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import { describeDb } from '../../helpers/describe-db';
import { BOOT_TIMEOUT_MS, createDayEndApp, D21, download, freshWorld, storageCalls, upload, type DayWorld } from '../../inc3/dayend/support';

jest.setTimeout(120_000);

describeDb('review23 security: XML entities in a day-end upload', () => {
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

  async function withAbout(sheet: Buffer, aboutXml: (original: string) => string): Promise<Buffer> {
    const zip = await JSZip.loadAsync(sheet);
    // exceljs keeps the "About" values (the format word among them) in the shared strings part.
    const name = 'xl/sharedStrings.xml';
    const original = await zip.file(name)?.async('string');
    if (!original || !original.includes('smart-fleet-day-end/1')) throw new Error('no format word in the shared strings');
    zip.file(name, aboutXml(original));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  it('REV23-SEC-XXE an external entity or a "billion laughs" DOCTYPE in the sheet is refused at once and reads nothing', async () => {
    const secret = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rev23-xxe-')), 'secret.txt');
    fs.writeFileSync(secret, 'smart-fleet-day-end/1');
    const sheet = await download(w, D21);
    const doctype = (entities: string) => (xml: string) =>
      xml.replace(/^(<\?xml[^>]*\?>)/, `$1<!DOCTYPE sst [${entities}]>`).replace(/smart-fleet-day-end\/1/g, '&e;');
    let laughs = '<!ENTITY l0 "lol">';
    for (let i = 1; i <= 9; i++) laughs += `<!ENTITY l${i} "${`&l${i - 1};`.repeat(10)}">`;
    const files = {
      external: await withAbout(sheet, doctype(`<!ENTITY e SYSTEM "file:///${secret.split(path.sep).join('/')}">`)),
      internal: await withAbout(sheet, doctype('<!ENTITY e "smart-fleet-day-end/1">')),
      laughs: await withAbout(sheet, doctype(`${laughs}<!ENTITY e "&l9;">`)),
    };
    for (const [kind, file] of Object.entries(files)) {
      const started = Date.now();
      const res = await upload(w, file, D21);
      expect({ kind, status: res.status, code: res.body.code }).toEqual({ kind, status: 422, code: 'DAY_SHEET_UNREADABLE' });
      expect(Date.now() - started).toBeLessThan(5_000);
    }
    expect(storageCalls(app).filter((call) => call.command === 'PutObjectCommand')).toHaveLength(1); // the sheet download only
  });
});
