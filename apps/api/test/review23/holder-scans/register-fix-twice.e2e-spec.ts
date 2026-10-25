/**
 * [review23 holder-scans] A day-end REGISTER fix applied twice (API_CONTRACT §10.2 "REGISTER: an extra
 * number. On approval it becomes a new cylinder in the home store ... and the next short number").
 *
 * After a reopen ("applied fixes stay"), the shop may upload again, and the newest sheet is still the one it
 * filled before (`sheetFileId` unchanged), so re-sending the same file is accepted and the day reads READY.
 * Every other fix is idempotent against the app as it now is (a moved cylinder now matches the sheet), but
 * the Extra row's number was never a cylinder number, so it is an unknown cylinder again and the second
 * approval registers a second new cylinder for the one physical cylinder the shop found.
 */
import type { INestApplication } from '@nestjs/common';
import { describeDb } from '../../helpers/describe-db';
import {
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  D21,
  approve,
  createDayEndApp,
  download,
  fill,
  freshWorld,
  upload,
  type DayWorld,
} from '../../inc3/dayend/support';
import { dayCloseOf } from '../../helpers/day-end';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('review23 holder-scans: a day-end extra cylinder registered twice', () => {
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

  it('re-sending the filled sheet after a reopen does not add the found cylinder a second time', async () => {
    const { std, calls } = w;
    const before = await w.db.cylinder.count({ where: { distributorId: std.DA.id } });
    // The shop finds an unlisted cylinder labelled AG-C0099 and puts it on Extra cylinders.
    const filled = await fill(await download(w), {}, { extra: [{ number: 'AG-C0099', size: '11.8 kg', state: 'Empty' }] });
    const first = await upload(w, filled);
    expect(first.status).toBe(200);
    await calls.submit(std.DA, D21, { version: first.body.version }).expect(200);
    const day = await dayCloseOf(std.DA.id, D21);
    const firstApproval = await approve(w, day!.id, first.body.version);
    expect(firstApproval.body.registered.map((c: { shortCode: string }) => c.shortCode)).toEqual(['AG-C0036']);

    // The office reopens the day (rare), and the shop sends its filled sheet again.
    await calls.reopen(std.SA1, day!.id, { reason: 'Recount the 15 kg cylinders' }).expect(200);
    const again = await upload(w, filled);
    expect(again.status).toBe(200);
    await calls.submit(std.DA, D21, { version: again.body.version }).expect(200);
    const secondApproval = await approve(w, day!.id, again.body.version);

    // One physical cylinder was found: the shop must still have exactly one more cylinder than before.
    const after = await w.db.cylinder.count({ where: { distributorId: std.DA.id } });
    expect({ registeredAgain: secondApproval.body.registered.map((c: { shortCode: string }) => c.shortCode), added: after - before }).toEqual({
      registeredAgain: [],
      added: 1,
    });
  });
});
