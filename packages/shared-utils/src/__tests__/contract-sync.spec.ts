/**
 * shared-utils has no dependencies, so it repeats a few shared-types unions. These checks fail when a
 * copy drifts (type-level checks fail the ts-jest compile; the rest fail at run time).
 */
import {
  DAY_END_STAGES,
  ERROR_CODES,
  ERROR_DETAIL_KEYS,
  ERROR_MESSAGE_EN,
  FillingOrderStatus,
  ORDER_STAGES,
  OrderStatus,
  REFILL_STAGES,
  type DayCloseStatus,
  type DayEndStage,
  type OrderStage,
  type RefillCounts,
  type RefillStage,
} from '../../../shared-types/src';
import { deriveDayEndStage, type DayCloseStatusLike, type DerivedDayEndStage } from '../day-end-stage';
import { renderMessage } from '../messages';
import { deriveOrderStage, type DerivedOrderStage, type OrderStatusLike } from '../order-stage';
import { deriveRefillStage, type DerivedRefillStage, type RefillCountsLike, type RefillStatusLike } from '../refill-stage';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('shared-utils matches shared-types', () => {
  it('derives exactly the OrderStage values', () => {
    const stagesMatch: Equals<DerivedOrderStage, OrderStage> = true;
    const statusesMatch: Equals<OrderStatusLike, `${OrderStatus}`> = true;
    expect(stagesMatch && statusesMatch).toBe(true);

    const seen = new Set<string>();
    for (const status of Object.values(OrderStatus)) {
      for (const loadStartedAt of [null, '2025-10-21T10:00:00Z']) {
        for (const onTheWayAt of [null, '2025-10-21T10:30:00Z']) {
          seen.add(deriveOrderStage({ status, loadStartedAt, onTheWayAt }));
        }
      }
    }
    expect([...seen].sort()).toEqual([...ORDER_STAGES].sort());
  });

  it('derives exactly the RefillStage values from the FillingOrderStatus values', () => {
    const stagesMatch: Equals<DerivedRefillStage, RefillStage> = true;
    const statusesMatch: Equals<RefillStatusLike, FillingOrderStatus> = true;
    const countsMatch: Equals<RefillCountsLike, RefillCounts> = true;
    expect(stagesMatch && statusesMatch && countsMatch).toBe(true);

    const seen = new Set<string>();
    for (const status of Object.values(FillingOrderStatus)) {
      for (const picked of [0, 1]) {
        for (const increment of [1, 3] as const) {
          seen.add(deriveRefillStage({ status, counts: { picked, received: status === 'FILLED' ? picked : 0 }, increment }));
        }
      }
    }
    expect([...seen].sort()).toEqual([...REFILL_STAGES].sort());
  });

  it('derives exactly the DayEndStage values', () => {
    const stagesMatch: Equals<DerivedDayEndStage, DayEndStage> = true;
    const statusesMatch: Equals<DayCloseStatusLike, DayCloseStatus> = true;
    expect(stagesMatch && statusesMatch).toBe(true);
    const t1 = '2026-10-21T15:00:00Z';
    const t2 = '2026-10-21T16:00:00Z';
    const seen = new Set<string>([
      deriveDayEndStage(null),
      deriveDayEndStage({ status: 'OPEN', sheetSnapshotAt: t1, uploadedAt: t2 }),
      deriveDayEndStage({ status: 'OPEN', sentBackAt: t2 }),
      deriveDayEndStage({ status: 'SUBMITTED' }),
      deriveDayEndStage({ status: 'APPROVED' }),
    ]);
    expect([...seen].sort()).toEqual([...DAY_END_STAGES].sort());
  });

  it('renders every error template from its documented details', () => {
    for (const code of ERROR_CODES) {
      const details: Record<string, string> = {};
      for (const key of ERROR_DETAIL_KEYS[code] ?? []) details[key] = key.endsWith('Paisa') ? '12300' : 'x';
      const message = renderMessage(ERROR_MESSAGE_EN[code], details);
      expect({ code, message }).toEqual({ code, message: expect.not.stringContaining('{{') });
    }
  });

  it('formats money in error messages', () => {
    expect(
      renderMessage(ERROR_MESSAGE_EN.TOPUP_WOULD_EXCEED_CAP, { capPaisa: '5000000', maxNowPaisa: '150000' }),
    ).toBe("Your balance can't go above Rs 50,000. You can add up to Rs 1,500 now.");
  });
});
