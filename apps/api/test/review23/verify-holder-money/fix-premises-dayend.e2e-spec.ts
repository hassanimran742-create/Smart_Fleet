/**
 * [review23 verify holder-money] holder-scans-07's premise: the upload replaced the day's lines
 * (deleteMany then createMany), so after a reopen and a re-upload the first approval's applied lines, with
 * their applied_event_id, were gone before the second approval ran, and the history lost its day-end link.
 * The fix (day-end-lines.ts replaceDayLines) keeps each applied fix's link on the new line of the same
 * cylinder or extra number; this pins that.
 */
import type { INestApplication } from '@nestjs/common';
import { describeDb } from '../../helpers/describe-db';
import { dayCloseOf } from '../../helpers/day-end';
import { authHeader } from '../../helpers/auth';
import { http } from '../../helpers/http';
import {
  API,
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

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('review23 verify: day-end lines after a reopen and a re-upload', () => {
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

  it('REV23 holder-scans-07 the re-upload after a reopen keeps the applied REGISTER line and the history keeps its day-end link', async () => {
    const { std, calls } = w;
    const filled = await fill(await download(w), {}, { extra: [{ number: 'AG-C0099', size: '11.8 kg', state: 'Empty' }] });
    const first = await upload(w, filled);
    expect(first.status).toBe(200);
    await calls.submit(std.DA, D21, { version: first.body.version }).expect(200);
    const day = await dayCloseOf(std.DA.id, D21);
    const approved = await approve(w, day!.id, first.body.version);
    expect(approved.body.registered.map((c: { shortCode: string }) => c.shortCode)).toEqual(['AG-C0036']);
    const history = async () =>
      (await http(app).get(`${API}/cylinders/AG-C0036/history`).set(authHeader(std.SA1.actor)).expect(200)).body.events as Array<{
        action: string;
        dayEnd: { businessDate: string } | null;
      }>;
    const appliedBefore = await w.db.dayCloseLine.count({ where: { dayCloseId: day!.id, appliedEventId: { not: null } } });
    const linkBefore = (await history()).find((e) => e.action === 'REGISTERED')?.dayEnd ?? null;

    await calls.reopen(std.SA1, day!.id, { reason: 'Recount the 15 kg cylinders' }).expect(200);
    const again = await upload(w, filled);
    expect(again.status).toBe(200);
    const appliedAfter = await w.db.dayCloseLine.count({ where: { dayCloseId: day!.id, appliedEventId: { not: null } } });
    const unknownAfter = await w.db.dayCloseLine.findMany({ where: { dayCloseId: day!.id, diff: 'UNKNOWN_CYLINDER' }, select: { sheetKey: true, appliedEventId: true } });
    const linkAfter = (await history()).find((e) => e.action === 'REGISTERED')?.dayEnd ?? null;
    // eslint-disable-next-line no-console
    console.log(`[verify-07] applied lines before ${appliedBefore} after ${appliedAfter}; unknown after ${JSON.stringify(unknownAfter)}; link ${JSON.stringify(linkBefore)} -> ${JSON.stringify(linkAfter)}`);
    expect({ appliedBefore, linkBefore }).toEqual({ appliedBefore: 1, linkBefore: { businessDate: D21 } });
    expect({ appliedAfter, unknownAfter, linkAfter }).toEqual({
      appliedAfter: 1,
      unknownAfter: [{ sheetKey: 'AG-C0099', appliedEventId: expect.any(String) }],
      linkAfter: { businessDate: D21 },
    });
  });
});
