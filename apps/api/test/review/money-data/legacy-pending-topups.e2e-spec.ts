/**
 * Review finding money-data-08 (legacy data, low): top-up requests the old app left PENDING can't all be
 * approved for what was paid.
 *
 * The 0.1.0 shop app asked for at least Rs 100 and allowed paisa (TopupScreen.tsx at af889bf:
 * `Math.round(Number(amount) * 100)`, `amt < 10000` refused), and the old API had no limit at all. Such a
 * request still PENDING at the switch-over is a real payment in the company bank. The new approval
 * applies today's rules to the bank amount.
 *
 * Verifier: REFUTED, documented behaviour. API_CONTRACT §7.9 approve rule 4 ("The bank amount must be
 * whole rupees and within the limits") and §1.1 (top-ups are whole rupees). The office is not stuck:
 * topup.minPaisa and topup.maxPaisa are editable settings, and widening them for the approval works
 * (test/review/verify/legacy-topup-workaround.e2e-spec.ts). Only a paisa amount can't be credited
 * exactly, as the docs require. This file therefore pins the documented refusals: changing them is a
 * contract change (§7.9) that must update the docs first.
 */
import type { INestApplication } from '@nestjs/common';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData, DUMMY_COMPANY_ACCOUNT } from '../../helpers/standard-data';
import { seedTopup } from '../../money/money-fixtures';
import { OrdersFixture } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(120_000);

describeDb('review money-data: old pending top-ups at the switch-over', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
    await app.get(SettingsService).set('topup.account', { ...DUMMY_COMPANY_ACCOUNT }, systemActor('cli:settings'), 'review setup', {
      allowNotEditable: true,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const approve = (id: string, bankAmountPaisa: string, ref: string) =>
    f.as(f.std.SA1).post(`/payments/${id}/approve`).send({ bankReference: ref, bankAmountPaisa, bankTime: new Date(Date.now() - 3_600_000).toISOString() });

  it('REFUTED money-data-08 an old Rs 300, Rs 60,000 or Rs 1,234.50 request is refused with the documented codes under the pilot limits, and nothing changes', async () => {
    const { std } = f;
    const balanceBefore = (await f.db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa;
    // As the old code wrote them: BANK_MANUAL, no payer name, PENDING (provider_txn_id NULLed by inc1a).
    const small = await seedTopup({ distributor: std.DA, amountPaisa: 30_000n, payerName: null });
    const large = await seedTopup({ distributor: std.DA, amountPaisa: 6_000_000n, payerName: null });
    const paisa = await seedTopup({ distributor: std.DA, amountPaisa: 123_450n, payerName: null });
    const results = [await approve(small.id, '30000', 'FT-OLD-0001'), await approve(large.id, '6000000', 'FT-OLD-0002'), await approve(paisa.id, '123450', 'FT-OLD-0003')];
    // §7.9 approve rule 4 and §1.1: the bank amount is whole rupees within topup.minPaisa–maxPaisa.
    expect(results.map((r) => ({ status: r.status, code: r.body.code ?? null }))).toEqual([
      { status: 400, code: 'TOPUP_AMOUNT_TOO_SMALL' },
      { status: 400, code: 'TOPUP_AMOUNT_TOO_LARGE' },
      { status: 400, code: 'AMOUNT_NOT_WHOLE_RUPEES' },
    ]);
    // A refused approval writes nothing: every request is still PENDING and the balance is unchanged.
    const statuses = await f.db.payment.findMany({ where: { id: { in: [small.id, large.id, paisa.id] } }, select: { status: true } });
    expect(statuses.map((p) => p.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect((await f.db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa).toBe(balanceBefore);
    await f.expectWalletsConsistent();
  });
});
