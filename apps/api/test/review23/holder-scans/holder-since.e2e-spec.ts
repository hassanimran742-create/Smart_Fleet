/**
 * [review23 holder-scans] The cylinder history's holder line (API_CONTRACT §9.4 `holder: { type, label, since,
 * responsible }`; UX_ADMIN §3.5 "On van LEA-101 · since 9:40 am", "Responsible driver: Kashif"). A refill FILL
 * is VEHICLE -> VEHICLE (no filling-station holder, ADR-13): the cylinder has been on the van since the pickup,
 * and the fill moves it nowhere, so "since" must stay the pickup time.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildRefillWorld, type RefillWorld } from '../../inc3/refills/support/refill-world';

jest.setTimeout(300_000);

describeDb('review23 holder-scans: "since" of the holder line', () => {
  let app: INestApplication;
  let w: RefillWorld;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildRefillWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a refill cylinder is "on van LEA-101 since" its pickup, not since its fill', async () => {
    const { std } = w;
    await w.empty(1);
    const r1 = await w.refill({ count: 1, assignTo: std.DR1 });
    const pickup = await w.pickup(std.DR1, r1, 1).expect(201);
    await w.advance(std.DR1, r1, 'EMPTIES_PICKED').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const fill = await w.fill(std.DR1, r1, 1).expect(201);
    expect(fill.body.scan.at > pickup.body.scan.at).toBe(true);

    const history = await w.scans.cylinderHistory(std.SA1, 'AG-C0001').expect(200);
    expect(history.body.holder).toMatchObject({ type: 'VEHICLE', label: 'LEA-101', responsible: { name: 'Kashif' } });
    expect({ since: history.body.holder.since }).toEqual({ since: pickup.body.scan.at });
  });
});
