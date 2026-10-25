/**
 * [review23 holder-scans] G06-02 (API_CONTRACT §9.2 "The responsible driver"): the driver of the trip or
 * refill of the latest event that moved the cylinder ONTO a van (LOAD, TAKE_BACK, refill PICKUP, office
 * manual take-back) since it last entered a store. An approved day-end SET_STATE or MARK_LOST fix keeps the
 * holder (ADJUSTED, VEHICLE -> VEHICLE): it moves nothing onto a van, so the driver who loaded it must stay
 * responsible. The office's Find cylinder shows "Responsible driver: Kashif" (UX_ADMIN §3.5).
 */
import type { INestApplication } from '@nestjs/common';
import { authHeader } from '../../helpers/auth';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import {
  API,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  approve,
  createDayEndApp,
  freshWorld,
  loadScan,
  submittedDay,
  tripNeeding,
  vanOf,
  type DayWorld,
} from '../../inc3/dayend/support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('review23 holder-scans: responsible driver after a day-end fix on a van', () => {
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

  async function history(code: string) {
    const res = await http(app).get(`${API}/cylinders/${code}/history`).set(authHeader(w.std.SA1.actor));
    expect(res.status).toBe(200);
    return res.body;
  }

  it.each([
    ['MARK_LOST', { where: 'Missing', why: 'Not found at the count' }, 'LOST'],
    ['SET_STATE', { where: "On driver's van", state: 'Damaged', why: 'Valve leaking, driver says' }, 'FAULTY'],
  ])('a %s fix of a cylinder Kashif loaded keeps Kashif responsible', async (_fix, row, toState) => {
    // Kashif loads AG-C0010 onto LEA-101 by a real scan: he is responsible.
    const trip = await tripNeeding(w, { driver: 'DR1', size: 'kg11_8', needs: 1 });
    expect((await loadScan(w, 'DR1', trip, w.ag(10))).status).toBe(201);
    const before = await history('AG-C0010');
    expect(before.holder).toMatchObject({ type: 'VEHICLE', label: 'LEA-101', responsible: { name: 'Kashif', role: 'DRIVER' } });

    // The day-end sheet says the van's cylinder is missing (or damaged); the office approves the fix.
    const day = await submittedDay(w, { 'AG-C0010': row });
    await approve(w, day.id, day.version);

    const cylinder = await w.db.cylinder.findUniqueOrThrow({ where: { id: w.ag(10).id } });
    expect(cylinder).toMatchObject({ custodyType: 'VEHICLE', custodyId: vanOf(w, 'DR1'), state: toState });
    const after = await history('AG-C0010');
    expect(after.holder.type).toBe('VEHICLE');
    expect(after.holder.label).toBe('LEA-101');
    // Still on Kashif's van, and nobody but Kashif ever put it there: he is still responsible.
    expect(after.holder.responsible).toMatchObject({ name: 'Kashif', role: 'DRIVER' });
  });
});
