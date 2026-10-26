/**
 * Review 23 (robustness, jobs and operations): the refill lists are cut at the 200 newest refills
 * (filling-orders.service.ts LIST_LIMIT), whatever their status. The website's Refills page reads the
 * office list once, every 15 seconds, and sorts it into its tabs in the browser
 * (apps/admin-web/src/features/refills/api.ts:29-36, RefillsPage.tsx:73). At pilot scale (two shops,
 * a refill or two a day each, at most 30 cylinders a refill) the 201st refill comes within months; after
 * that an older refill still open (waiting for a driver, or one whose cylinder never came back, which by
 * design stays open) is in no tab, while the Today card still counts it ("Refills need a driver").
 */
import type { INestApplication } from '@nestjs/common';
import { FillingOrderStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { createRefill, createStandardData, createStation, describeDb, type StandardData } from '../../helpers';
import { http } from '../../helpers/http';
import { authHeader } from '../../helpers/auth';

const DAY_MS = 86_400_000;

describeDb('review23 robustness: an old open refill falls off the office Refills page after 200 newer ones', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /filling-orders still lists a refill that needs a driver when 200 newer refills exist', async () => {
    const station = await createStation();
    const now = Date.now();
    // Four months ago Bilal Gas asked for a refill that is still waiting for a driver.
    const old = await createRefill({ distributor: std.DB, cylinderTypeId: std.sizes.kg15, requestedCount: 5, station, createdAt: new Date(now - 120 * DAY_MS) });
    // Since then: 200 finished refills, about one and a half a day across the two shops.
    for (let i = 0; i < 200; i++) {
      await createRefill({
        distributor: i % 2 ? std.DA : std.DB,
        cylinderTypeId: std.sizes.kg11_8,
        requestedCount: 20,
        station,
        status: FillingOrderStatus.COMPLETED,
        createdAt: new Date(now - 119 * DAY_MS + i * 14 * 3_600_000),
      });
    }
    const office = authHeader(std.SA1.actor);
    const summary = await http(app).get('/api/v1/admin/summary').set(office);
    const list = await http(app).get('/api/v1/filling-orders').set(office);
    const ids = (list.body as Array<{ id: string; status: string }>).map((refill) => refill.id);
    // eslint-disable-next-line no-console
    console.log(
      `[refills] Today card needsDriver=${summary.body.refills?.needsDriver}; office list rows=${ids.length}, ` +
        `${JSON.stringify(list.body).length} bytes, includes the waiting ${old.shortCode}: ${ids.includes(old.id)}`,
    );
    expect(summary.body.refills?.needsDriver).toBe(1);
    expect(ids).toContain(old.id);
  });
});
