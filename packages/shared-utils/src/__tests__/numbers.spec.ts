import { formatNo, parseCylinderNo } from '../numbers';

describe('formatNo', () => {
  it('formats every human number from the distributor code', () => {
    expect(formatNo('AG', 'ORDER', 142)).toBe('AG-0142');
    expect(formatNo('AG', 'TOPUP', 31)).toBe('AG-T031');
    expect(formatNo('AG', 'REFILL', 7)).toBe('AG-R007');
    expect(formatNo('AG', 'CYLINDER', 42)).toBe('AG-C0042');
  });

  it('prints wide numbers in full', () => {
    expect(formatNo('AG', 'ORDER', 12345)).toBe('AG-12345');
    expect(formatNo('D01', 'TOPUP', 1234)).toBe('D01-T1234');
  });

  it('returns only the number part without a code', () => {
    expect(formatNo(null, 'CYLINDER', 42)).toBe('C0042');
    expect(formatNo(undefined, 'TOPUP', 31)).toBe('T031');
    expect(formatNo('  ', 'ORDER', 1)).toBe('0001');
  });

  it('refuses numbers that are not whole and non-negative', () => {
    expect(() => formatNo('AG', 'ORDER', -1)).toThrow(RangeError);
    expect(() => formatNo('AG', 'ORDER', 1.5)).toThrow(RangeError);
    expect(() => formatNo('AG', 'ORDER', Number.NaN)).toThrow(RangeError);
  });
});

describe('FND-027 formatNo makes the human numbers from the distributor code, and parseCylinderNo reads typed cylinder numbers', () => {
  it('FND-027 formatNo pads, never cuts, and works with back-filled codes', () => {
    expect(formatNo('AG', 'ORDER', 142)).toBe('AG-0142');
    expect(formatNo('AG', 'TOPUP', 31)).toBe('AG-T031');
    expect(formatNo('AG', 'REFILL', 7)).toBe('AG-R007');
    expect(formatNo('AG', 'CYLINDER', 42)).toBe('AG-C0042');
    expect(formatNo('BG', 'ORDER', 1)).toBe('BG-0001');
    expect(formatNo('AG', 'ORDER', 9999)).toBe('AG-9999');
    expect(formatNo('AG', 'ORDER', 10000)).toBe('AG-10000');
    expect(formatNo('AG', 'TOPUP', 1000)).toBe('AG-T1000');
    expect(formatNo('AG', 'CYLINDER', 10000)).toBe('AG-C10000');
    expect(formatNo('D01', 'ORDER', 5)).toBe('D01-0005');
  });

  it.each(['42', '0042', 'c0042', 'AG-C0042', ' ag-c 0042 ', '۴۲'])(
    'FND-027 parseCylinderNo reads %p within AG as cylinder 42',
    (text) => {
      expect(parseCylinderNo(text, 'AG')).toEqual({ code: 'AG', shortNo: 42 });
    },
  );

  it.each(['AG-0042', 'BG-C0042', '0', '1234567', 'C'])('FND-027 parseCylinderNo refuses %p within AG', (text) => {
    expect(parseCylinderNo(text, 'AG')).toBeNull();
  });

  it('FND-027 parseCylinderNo reads the full form without a distributor in context', () => {
    expect(parseCylinderNo('AG-C0042')).toEqual({ code: 'AG', shortNo: 42 });
  });
});

describe('parseCylinderNo edges (API_CONTRACT §1.1)', () => {
  it('reads Arabic-Indic digits and any case, and compares the context code case-insensitively', () => {
    expect(parseCylinderNo('٤٢', 'ag')).toEqual({ code: 'AG', shortNo: 42 });
    expect(parseCylinderNo('ag-c42', ' Ag ')).toEqual({ code: 'AG', shortNo: 42 });
    expect(parseCylinderNo('D01-C0007', 'D01')).toEqual({ code: 'D01', shortNo: 7 });
  });

  it('accepts 1 to 6 digits with a value of at least 1', () => {
    expect(parseCylinderNo('1', 'AG')).toEqual({ code: 'AG', shortNo: 1 });
    expect(parseCylinderNo('999999', 'AG')).toEqual({ code: 'AG', shortNo: 999999 });
    expect(parseCylinderNo('C000000', 'AG')).toBeNull();
    expect(parseCylinderNo('0000', 'AG')).toBeNull();
  });

  it('leaves the code empty for a short form with no distributor in context', () => {
    expect(parseCylinderNo('42')).toEqual({ code: null, shortNo: 42 });
    expect(parseCylinderNo('C0042', null)).toEqual({ code: null, shortNo: 42 });
  });

  it('refuses order and top-up forms, a lone code, other letters and empty text', () => {
    for (const text of ['AG-T031', 'AG-R007', 'AG', 'AG-', 'AG-C', 'X42', '42A', '4 2 A', '', '   ', 'A-C0042', 'ABCDEFG-C1']) {
      expect({ text, parsed: parseCylinderNo(text, 'AG') }).toEqual({ text, parsed: null });
    }
    expect(parseCylinderNo(undefined as unknown as string)).toBeNull();
  });

  it('round-trips with formatNo', () => {
    for (const n of [1, 42, 999, 10000, 123456]) {
      expect(parseCylinderNo(formatNo('AG', 'CYLINDER', n), 'AG')).toEqual({ code: 'AG', shortNo: n });
    }
  });
});
