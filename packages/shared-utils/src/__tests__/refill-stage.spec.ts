import {
  deriveRefillStage,
  legacyRefillCounts,
  type RefillStageInput,
  type RefillStatusLike,
} from '../refill-stage';

const none = { requested: 2, picked: 0, filled: 0, received: 0 };

describe('deriveRefillStage (API_CONTRACT §1.4, G08-04)', () => {
  it.each<[RefillStageInput, string]>([
    [{ status: 'CANCELLED' }, 'CANCELLED'],
    [{ status: 'FAILED' }, 'CANCELLED'],
    [{ status: 'COMPLETED', counts: { requested: 2, picked: 2, filled: 1, received: 2 } }, 'DONE'],
    [{ status: 'RETURNED', counts: { requested: 2, picked: 2, filled: 2, received: 2 } }, 'BACK_AT_STORE'],
    [{ status: 'FILLED', counts: { requested: 2, picked: 2, filled: 2, received: 0 } }, 'COMING_BACK'],
    [{ status: 'AT_STATION' }, 'AT_STATION'],
    [{ status: 'EMPTIES_PICKED' }, 'PICKED_UP'],
    [{ status: 'ASSIGNED', counts: { requested: 2, picked: 1 } }, 'PICKING_UP'],
    [{ status: 'ASSIGNED', counts: none }, 'DRIVER_ASSIGNED'],
    [{ status: 'ASSIGNED' }, 'DRIVER_ASSIGNED'],
    [{ status: 'PENDING' }, 'NEEDS_DRIVER'],
  ])('%o is %s', (refill, stage) => {
    expect(deriveRefillStage(refill)).toBe(stage);
  });

  it('reads BACK_AT_STORE from the RETURNED status in Inc 1 and from received scans from Inc 3', () => {
    const scannedIn = { status: 'FILLED' as const, counts: { requested: 2, picked: 2, filled: 2, received: 1 } };
    expect(deriveRefillStage(scannedIn)).toBe('COMING_BACK');
    expect(deriveRefillStage({ ...scannedIn, increment: 3 })).toBe('BACK_AT_STORE');
    expect(deriveRefillStage({ status: 'ASSIGNED', counts: { picked: 1, received: 1 }, increment: 3 })).toBe('BACK_AT_STORE');
  });

  it('puts status first: a finished or cancelled refill never shows its counts', () => {
    expect(deriveRefillStage({ status: 'CANCELLED', counts: { picked: 1, received: 1 }, increment: 3 })).toBe('CANCELLED');
    expect(deriveRefillStage({ status: 'COMPLETED', counts: { picked: 0 } })).toBe('DONE');
    expect(deriveRefillStage({ status: 'EMPTIES_PICKED', counts: { picked: 0 } })).toBe('PICKED_UP');
  });

  it('treats missing or odd counts as 0 and an unknown status as waiting for a driver', () => {
    expect(deriveRefillStage({ status: 'ASSIGNED', counts: { picked: Number.NaN } })).toBe('DRIVER_ASSIGNED');
    expect(deriveRefillStage({ status: 'ASSIGNED', counts: null })).toBe('DRIVER_ASSIGNED');
    expect(deriveRefillStage({ status: 'SOMETHING_NEW' as RefillStatusLike })).toBe('NEEDS_DRIVER');
  });
});

describe('legacyRefillCounts (Inc 1 refill DTO counts)', () => {
  it('reads the legacy columns, missing = 0, received = picked once RETURNED or COMPLETED', () => {
    expect(legacyRefillCounts({ status: 'PENDING', requestedCount: 3 })).toEqual({ requested: 3, picked: 0, filled: 0, received: 0 });
    expect(legacyRefillCounts({ status: 'FILLED', requestedCount: 3, pickedUpEmptyCount: 2, filledCount: 1 })).toEqual({
      requested: 3,
      picked: 2,
      filled: 1,
      received: 0,
    });
    expect(legacyRefillCounts({ status: 'RETURNED', requestedCount: 3, pickedUpEmptyCount: 2, filledCount: null })).toEqual({
      requested: 3,
      picked: 2,
      filled: 0,
      received: 2,
    });
    expect(legacyRefillCounts({ status: 'COMPLETED', requestedCount: 3, pickedUpEmptyCount: 3, filledCount: 3 })).toEqual({
      requested: 3,
      picked: 3,
      filled: 3,
      received: 3,
    });
  });
});
