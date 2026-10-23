import {
  formatRs,
  formatRupeesInput,
  isWholeRupees,
  MINUS_SIGN,
  parseRupeesInput,
  roundUpPaisa,
  toPaisa,
  toRupeesInput,
} from '../money';

describe('formatRs', () => {
  it('prints whole rupees with grouping and no decimals', () => {
    expect(formatRs(345000)).toBe('Rs 3,450');
    expect(formatRs('345000')).toBe('Rs 3,450');
    expect(formatRs(BigInt(345000))).toBe('Rs 3,450');
    expect(formatRs(100000000)).toBe('Rs 1,000,000');
    expect(formatRs(0)).toBe('Rs 0');
  });

  it('prints paisa only when there are some', () => {
    expect(formatRs(345050)).toBe('Rs 3,450.50');
    expect(formatRs(5)).toBe('Rs 0.05');
    expect(formatRs('99')).toBe('Rs 0.99');
  });

  it('marks money out with U+2212 and no space', () => {
    expect(formatRs(-33000)).toBe(`${MINUS_SIGN}Rs 330`);
    expect(formatRs('-33000')).toBe('−Rs 330');
    expect(formatRs(-5)).toBe('−Rs 0.05');
  });

  it('follows the sign option', () => {
    expect(formatRs(500000, { sign: 'always' })).toBe('+Rs 5,000');
    expect(formatRs(-33000, { sign: 'always' })).toBe('−Rs 330');
    expect(formatRs(-33000, { sign: 'none' })).toBe('Rs 330');
    expect(formatRs(0, { sign: 'always' })).toBe('Rs 0');
    expect(formatRs('-0')).toBe('Rs 0');
  });

  it('is exact beyond the safe-integer range for BigInt and strings', () => {
    expect(formatRs('123456789012345678901')).toBe('Rs 1,234,567,890,123,456,789.01');
    expect(formatRs(BigInt('900719925474099300'))).toBe('Rs 9,007,199,254,740,993');
  });

  it('ignores leading zeros', () => {
    expect(formatRs('000345000')).toBe('Rs 3,450');
  });

  it('prints a dash for a missing amount', () => {
    expect(formatRs(null)).toBe('—');
    expect(formatRs(undefined)).toBe('—');
  });

  it('throws on malformed amounts', () => {
    expect(() => formatRs(12.5)).toThrow(RangeError);
    expect(() => formatRs(Number.NaN)).toThrow(RangeError);
    expect(() => formatRs('12.50')).toThrow(TypeError);
    expect(() => formatRs('Rs 5')).toThrow(TypeError);
    expect(() => formatRs(' 5')).toThrow(TypeError);
  });
});

describe('toPaisa', () => {
  it('converts wire strings to safe integers', () => {
    expect(toPaisa('33000')).toBe(33000);
    expect(toPaisa('-33000')).toBe(-33000);
    expect(toPaisa(BigInt(42))).toBe(42);
    expect(toPaisa(7)).toBe(7);
    expect(toPaisa('0007')).toBe(7);
  });

  it('asserts a safe integer', () => {
    expect(() => toPaisa('9007199254740993')).toThrow(RangeError);
    expect(() => toPaisa(1.5)).toThrow(RangeError);
    expect(() => toPaisa('1e5')).toThrow(TypeError);
    expect(() => toPaisa('')).toThrow(TypeError);
  });
});

describe('isWholeRupees', () => {
  it('checks % 100', () => {
    expect(isWholeRupees(500000)).toBe(true);
    expect(isWholeRupees('0')).toBe(true);
    expect(isWholeRupees(500050)).toBe(false);
    expect(isWholeRupees('-33000')).toBe(true);
  });
});

describe('parseRupeesInput', () => {
  it('reads typed rupees into paisa', () => {
    expect(parseRupeesInput('5,000')).toBe(500000);
    expect(parseRupeesInput('5000')).toBe(500000);
    expect(parseRupeesInput(' 12 500 ')).toBe(1250000);
    expect(parseRupeesInput('0')).toBe(0);
    expect(parseRupeesInput('Rs 5,000')).toBe(500000);
    expect(parseRupeesInput('rs.250')).toBe(25000);
  });

  it('reads Urdu and Arabic-Indic digits', () => {
    expect(parseRupeesInput('۵۰۰۰')).toBe(500000);
    expect(parseRupeesInput('٥٠٠٠')).toBe(500000);
  });

  it('refuses decimals, signs and text', () => {
    expect(parseRupeesInput('5000.50')).toBeNull();
    expect(parseRupeesInput('-5000')).toBeNull();
    expect(parseRupeesInput('five')).toBeNull();
    expect(parseRupeesInput('')).toBeNull();
    expect(parseRupeesInput('   ')).toBeNull();
    expect(parseRupeesInput(null)).toBeNull();
    expect(parseRupeesInput(undefined)).toBeNull();
  });

  it('refuses amounts that would not stay exact', () => {
    expect(parseRupeesInput('900719925474099')).toBeNull();
    expect(parseRupeesInput('90071992547409')).toBe(9007199254740900);
  });
});

describe('formatRupeesInput', () => {
  it('regroups digits as you type', () => {
    expect(formatRupeesInput('5000')).toBe('5,000');
    expect(formatRupeesInput('5,0000')).toBe('50,000');
    expect(formatRupeesInput('0050')).toBe('50');
    expect(formatRupeesInput('12a3')).toBe('123');
    expect(formatRupeesInput('')).toBe('');
    expect(formatRupeesInput(null)).toBe('');
  });
});

describe('toRupeesInput', () => {
  it('turns paisa into field text, rounding up to a whole rupee', () => {
    expect(toRupeesInput(500000)).toBe('5,000');
    expect(toRupeesInput('21050')).toBe('211');
    expect(toRupeesInput(99999)).toBe('1,000');
    expect(toRupeesInput(0)).toBe('0');
    expect(toRupeesInput(1)).toBe('1');
  });

  it('refuses negative amounts', () => {
    expect(() => toRupeesInput(-100)).toThrow(RangeError);
  });
});

describe('roundUpPaisa', () => {
  it('rounds up to the step in integer maths', () => {
    expect(roundUpPaisa(21050, 10000)).toBe(30000);
    expect(roundUpPaisa('20000', 10000)).toBe(20000);
    expect(roundUpPaisa(0, 10000)).toBe(0);
    expect(roundUpPaisa(1, 100)).toBe(100);
  });

  it('refuses a bad step or a negative amount', () => {
    expect(() => roundUpPaisa(100, 0)).toThrow(RangeError);
    expect(() => roundUpPaisa(-100, 100)).toThrow(RangeError);
  });
});

describe('FND-024 formatRs prints money as "Rs 3,450"', () => {
  it('FND-024 prints every documented amount, with U+2212 for money out and no "Rs.", "PKR" or ".00"', () => {
    const cases: [number | string | bigint, string][] = [
      [345000, 'Rs 3,450'],
      ['345000', 'Rs 3,450'],
      [BigInt(345000), 'Rs 3,450'],
      [345050, 'Rs 3,450.50'],
      [5, 'Rs 0.05'],
      [1, 'Rs 0.01'],
      [0, 'Rs 0'],
      [48000, 'Rs 480'],
      [452000, 'Rs 4,520'],
      [500000, 'Rs 5,000'],
      [5000000, 'Rs 50,000'],
      [10000000, 'Rs 100,000'],
      [100000000, 'Rs 1,000,000'],
      [-33000, '\u2212Rs 330'],
    ];
    for (const [input, expected] of cases) {
      const printed = formatRs(input);
      expect({ input: String(input), printed }).toEqual({ input: String(input), printed: expected });
      expect(printed).not.toMatch(/Rs\.|PKR|\.00\b/);
    }
    expect(formatRs(-33000)).not.toContain('- ');
    expect(formatRs(-33000).charCodeAt(0)).toBe(0x2212);
    expect(formatRs(500000, { sign: 'always' })).toBe('+Rs 5,000');
    expect(formatRs(0, { sign: 'always' })).toBe('Rs 0');
  });
});

describe('FND-025 toPaisa accepts only safe whole numbers of paisa', () => {
  it('FND-025 converts safe whole numbers, signed ones included, and throws on anything else', () => {
    expect(toPaisa('345000')).toBe(345000);
    expect(toPaisa(345000)).toBe(345000);
    expect(toPaisa('0')).toBe(0);
    expect(toPaisa('-48000')).toBe(-48000);
    for (const bad of [1.5, '12.5', 'abc', '', 9007199254740992, '9007199254740993']) {
      expect(() => toPaisa(bad as number | string)).toThrow();
    }
  });
});

describe('FND-026 parseRupeesInput turns typed rupees into paisa and refuses anything else', () => {
  it.each<[string, number]>([
    ['5,000', 500000],
    ['5000', 500000],
    ['480', 48000],
    ['50,000', 5000000],
    [' 1,234 ', 123400],
    ['0', 0],
  ])('FND-026 reads %p as %p paisa', (text, paisa) => {
    expect(parseRupeesInput(text)).toBe(paisa);
  });

  it.each(['', '5,000.50', '5.000', 'abc', '-500'])('FND-026 refuses %p (not a whole, positive rupee amount)', (text) => {
    expect(parseRupeesInput(text)).toBeNull();
  });
});
