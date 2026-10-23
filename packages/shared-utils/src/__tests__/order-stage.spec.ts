import { deriveOrderStage, type OrderStageInput } from '../order-stage';

const at = '2026-10-21T10:00:00.000Z';

describe('deriveOrderStage', () => {
  it.each<[OrderStageInput, string]>([
    [{ status: 'PENDING' }, 'NEEDS_DRIVER'],
    [{ status: 'CONFIRMED' }, 'NEEDS_DRIVER'],
    [{ status: 'ASSIGNED' }, 'DRIVER_ASSIGNED'],
    [{ status: 'ASSIGNED', loadStartedAt: null, onTheWayAt: null }, 'DRIVER_ASSIGNED'],
    [{ status: 'ASSIGNED', loadStartedAt: at }, 'LOADING'],
    [{ status: 'ASSIGNED', loadStartedAt: new Date(at) }, 'LOADING'],
    [{ status: 'ASSIGNED', loadStartedAt: at, onTheWayAt: at }, 'ON_THE_WAY'],
    [{ status: 'IN_TRANSIT' }, 'ON_THE_WAY'],
    [{ status: 'IN_TRANSIT', loadStartedAt: at }, 'ON_THE_WAY'],
    [{ status: 'DELIVERED', onTheWayAt: at }, 'DELIVERED'],
    [{ status: 'FAILED', loadStartedAt: at }, 'NOT_DELIVERED'],
    [{ status: 'CANCELLED', onTheWayAt: at }, 'CANCELLED'],
  ])('%o is %s', (order, stage) => {
    expect(deriveOrderStage(order)).toBe(stage);
  });

  it('treats an empty or invalid timestamp as not set', () => {
    expect(deriveOrderStage({ status: 'ASSIGNED', loadStartedAt: '' })).toBe('DRIVER_ASSIGNED');
    expect(deriveOrderStage({ status: 'ASSIGNED', loadStartedAt: new Date(Number.NaN) })).toBe('DRIVER_ASSIGNED');
  });

  it('never breaks a list on an unknown status', () => {
    expect(deriveOrderStage({ status: 'SOMETHING_NEW' as OrderStageInput['status'] })).toBe('NEEDS_DRIVER');
  });
});

describe('FND-030 deriveOrderStage turns an order\'s status and times into one stage', () => {
  it('FND-030 follows the API_CONTRACT §1.4 table, first match wins', () => {
    const cases: [OrderStageInput, string][] = [
      [{ status: 'CANCELLED', loadStartedAt: at }, 'CANCELLED'],
      [{ status: 'FAILED' }, 'NOT_DELIVERED'],
      [{ status: 'DELIVERED' }, 'DELIVERED'],
      [{ status: 'IN_TRANSIT' }, 'ON_THE_WAY'],
      [{ status: 'ASSIGNED', loadStartedAt: at, onTheWayAt: at }, 'ON_THE_WAY'],
      [{ status: 'ASSIGNED', loadStartedAt: at }, 'LOADING'],
      [{ status: 'ASSIGNED' }, 'DRIVER_ASSIGNED'],
      [{ status: 'PENDING' }, 'NEEDS_DRIVER'],
      [{ status: 'CONFIRMED' }, 'NEEDS_DRIVER'],
    ];
    for (const [order, stage] of cases) expect({ order, stage: deriveOrderStage(order) }).toEqual({ order, stage });
  });

  it('FND-030 keeps a delivered order DELIVERED whatever the customer answered (Inc 2 field)', () => {
    const delivered = { status: 'DELIVERED', confirmation: { response: 'NO' } } as OrderStageInput & { confirmation: unknown };
    expect(deriveOrderStage(delivered)).toBe('DELIVERED');
  });
});
