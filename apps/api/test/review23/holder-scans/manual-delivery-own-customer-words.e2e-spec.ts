/**
 * [review23 holder-scans-09, REFUTED] The office's manual delivery v2 (API_CONTRACT §9.5) names a cylinder
 * that is already with THIS order's customer (her own earlier cylinder, typed by mistake). The server
 * refuses it as NOT_AVAILABLE with `holderType: 'CLIENT'` (scan.service.ts manualGiveProblem: any customer
 * holder), and the website shows every CLIENT refusal as "with another customer" (admin-web manual.ts
 * serverProblem, i18n orders.manual.problem.WITH_CUSTOMER).
 *
 * The verifier refuted it: that is the documented copy (UX_ADMIN §3.4 maps NOT_AVAILABLE holder CLIENT to
 * "· with another customer"; API_CONTRACT §9.5 holderType CLIENT is any customer). This test pins it. If the
 * owner wants "with a customer", only the copy changes (UX_ADMIN §3.4 and orders.ts), and so does the last
 * assertion.
 */
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X1, type World } from '../../inc2/scan/support/world';

jest.setTimeout(300_000);

/* eslint-disable @typescript-eslint/no-var-requires */
const WEB_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src');
const { serverProblem } = require(path.join(WEB_SRC, 'features', 'orders', 'manual.ts')) as typeof import('../../../../admin-web/src/features/orders/manual');
const { orders: ordersEn } = require(path.join(WEB_SRC, 'i18n', 'en', 'orders.ts')) as typeof import('../../../../admin-web/src/i18n/en/orders');
/* eslint-enable @typescript-eslint/no-var-requires */

describeDb('review23 holder-scans: manual delivery naming the customer\'s own cylinder', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REV23 holder-scans-09 (refuted) a cylinder already with a customer is refused NOT_AVAILABLE CLIENT, and the chip reads the documented "with another customer"', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1'); // AG-C0011 is Sana's from an earlier delivery
    const x1 = await w.placeOrder(X1);
    await w.assign(x1, std.DR1);
    const res = await scans.manualDelivery(std.SA1, x1.id, {
      reason: 'Driver forgot to scan at the store',
      cylinders: [{ code: 'AG-C0001' }, { code: 'AG-C0011' }, { code: 'AG-C0031' }],
    });
    expect(res.status).toBe(409);
    const problem = res.body.details.problems.find((p: { code: string }) => p.code === 'AG-C0011');
    expect(problem).toMatchObject({ reason: 'NOT_AVAILABLE', holderType: 'CLIENT' });
    expect(await w.holder(11)).toMatchObject({ custodyType: 'CLIENT', custodyId: std.C1.id });

    // What the office reads on the red chip: UX_ADMIN §3.4's words for a CLIENT holder.
    const words = ordersEn.manual.problem[serverProblem(problem, '11.8 kg').kind];
    expect(words).toBe('with another customer');
  });
});
