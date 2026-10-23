/**
 * The shared-utils functions the API and both apps depend on (foundation acceptance: `formatRs`,
 * `toPaisa`, `parseRupeesInput`, `formatNo`, `formatWhen`, `formatPkDateTime`, `businessDate`,
 * `deriveOrderStage`, `normalizePkPhone` with 0092, `formatPkPhone`). The package's own suites in
 * packages/shared-utils/src/__tests__ cover the edge cases in depth.
 */
import {
  businessDate,
  businessDayRange,
  deriveOrderStage,
  formatNo,
  formatPkDateTime,
  formatPkPhone,
  formatRs,
  formatWhen,
  normalizePkPhone,
  parseRupeesInput,
  renderMessage,
  toPaisa,
} from '@smartfleet/shared-utils';

describe('money', () => {
  it('formats paisa as "Rs 3,450", "Rs 3,450.50" and "−Rs 330" from every wire form', () => {
    expect(formatRs('345000')).toBe('Rs 3,450');
    expect(formatRs(BigInt(345000))).toBe('Rs 3,450');
    expect(formatRs(345050)).toBe('Rs 3,450.50');
    expect(formatRs('-33000')).toBe('−Rs 330');
    expect(formatRs(500000, { sign: 'always' })).toBe('+Rs 5,000');
    expect(formatRs(null)).toBe('—');
  });

  it('reads JSON paisa strings exactly', () => {
    expect(toPaisa('33000')).toBe(33000);
    expect(toPaisa(BigInt(42))).toBe(42);
  });

  it('parses what people type in rupees into paisa', () => {
    expect(parseRupeesInput('5,000')).toBe(500000);
    expect(parseRupeesInput('Rs 5,000')).toBe(500000);
    expect(parseRupeesInput('۵۰۰۰')).toBe(500000);
    expect(parseRupeesInput('5000.50')).toBeNull();
    expect(parseRupeesInput('-5000')).toBeNull();
  });
});

describe('formatNo (ADR-22)', () => {
  it('formats the four human numbers', () => {
    expect(formatNo('AG', 'ORDER', 142)).toBe('AG-0142');
    expect(formatNo('AG', 'TOPUP', 31)).toBe('AG-T031');
    expect(formatNo('AG', 'REFILL', 7)).toBe('AG-R007');
    expect(formatNo('AG', 'CYLINDER', 42)).toBe('AG-C0042');
  });
});

describe('Asia/Karachi time and the 03:00 business day', () => {
  const NOW = '2025-10-21T12:00:00.000Z';

  it('formats instants for people in Karachi', () => {
    expect(formatPkDateTime('2025-10-21T11:12:00Z')).toBe('Tue 21 Oct, 4:12 pm');
    expect(formatWhen('2025-10-21T11:12:00Z', NOW)).toBe('Today, 4:12 pm');
    expect(formatWhen('2025-10-20T04:05:00Z', NOW)).toBe('Yesterday, 9:05 am');
  });

  it('counts the hours before 03:00 as the previous business day', () => {
    expect(businessDate('2025-10-21T21:59:00Z')).toBe('2025-10-21'); // 02:59 on the 22nd
    expect(businessDate('2025-10-21T22:00:00Z')).toBe('2025-10-22'); // 03:00 on the 22nd
    const { start, end } = businessDayRange('2025-10-22');
    expect(start.toISOString()).toBe('2025-10-21T22:00:00.000Z');
    expect(end.toISOString()).toBe('2025-10-22T22:00:00.000Z');
  });
});

describe('deriveOrderStage (API_CONTRACT §1.4)', () => {
  it.each([
    [{ status: 'CANCELLED' as const }, 'CANCELLED'],
    [{ status: 'FAILED' as const }, 'NOT_DELIVERED'],
    [{ status: 'DELIVERED' as const }, 'DELIVERED'],
    [{ status: 'IN_TRANSIT' as const }, 'ON_THE_WAY'],
    [{ status: 'ASSIGNED' as const, onTheWayAt: '2025-10-21T10:00:00Z' }, 'ON_THE_WAY'],
    [{ status: 'ASSIGNED' as const, loadStartedAt: '2025-10-21T09:00:00Z' }, 'LOADING'],
    [{ status: 'ASSIGNED' as const }, 'DRIVER_ASSIGNED'],
    [{ status: 'PENDING' as const }, 'NEEDS_DRIVER'],
    [{ status: 'CONFIRMED' as const }, 'NEEDS_DRIVER'],
  ])('%j → %s', (order, stage) => {
    expect(deriveOrderStage(order)).toBe(stage);
  });
});

describe('Pakistani mobile numbers', () => {
  it.each(['03001234567', '0300 1234567', '+92 300 1234567', '923001234567', '0092 300 1234567', '00923001234567', '3001234567'])(
    'normalises %s to E.164',
    (raw) => {
      expect(normalizePkPhone(raw)).toBe('+923001234567');
    },
  );

  it('refuses landlines and wrong lengths', () => {
    expect(normalizePkPhone('04235761234')).toBeNull();
    expect(normalizePkPhone('0300123456')).toBeNull();
    expect(normalizePkPhone('')).toBeNull();
  });

  it('formats for screens', () => {
    expect(formatPkPhone('+923001234567')).toBe('0300 1234567');
    expect(formatPkPhone('+923001234567', 'international')).toBe('+92 300 1234567');
  });
});

describe('renderMessage (the API message and the apps share one rule)', () => {
  it('formats *Paisa details and drops the suffix', () => {
    expect(renderMessage('The delivery cost is now {{total}}.', { totalPaisa: '33000' })).toBe('The delivery cost is now Rs 330.');
  });
});
