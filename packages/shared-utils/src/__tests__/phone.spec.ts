import { formatPkPhone, isPkMobile, maskPhone, normalizePkPhone } from '../phone';

describe('normalizePkPhone', () => {
  it.each([
    ['03001234567'],
    ['0300 1234567'],
    ['0300-1234567'],
    ['(0300) 123-4567'],
    ['3001234567'],
    ['+923001234567'],
    ['+92 300 1234567'],
    ['923001234567'],
    ['92 300 1234567'],
    ['00923001234567'],
    ['0092 300 1234567'],
    ['+92 0300 1234567'],
    ['  0300.1234567  '],
    ['۰۳۰۰۱۲۳۴۵۶۷'],
  ])('accepts %s', (raw) => {
    expect(normalizePkPhone(raw)).toBe('+923001234567');
  });

  it.each([
    ['0300123456'],
    ['030012345678'],
    ['04235761234'],
    ['+13001234567'],
    ['0300-ABC-4567'],
    ['0300 123456x'],
    ['++923001234567'],
    ['+'],
    [''],
    ['   '],
  ])('refuses %s', (raw) => {
    expect(normalizePkPhone(raw)).toBeNull();
  });

  it('refuses missing values', () => {
    expect(normalizePkPhone(null)).toBeNull();
    expect(normalizePkPhone(undefined)).toBeNull();
    expect(isPkMobile('03001234567')).toBe(true);
    expect(isPkMobile('0300')).toBe(false);
  });
});

describe('formatPkPhone', () => {
  it('prints the local form by default', () => {
    expect(formatPkPhone('+923001234567')).toBe('0300 1234567');
    expect(formatPkPhone('03001234567')).toBe('0300 1234567');
  });

  it('prints the international form', () => {
    expect(formatPkPhone('+923001234567', 'international')).toBe('+92 300 1234567');
  });

  it('returns other numbers as stored', () => {
    expect(formatPkPhone(' 042 3576 1234 ')).toBe('042 3576 1234');
    expect(formatPkPhone(null)).toBe('');
  });
});

describe('maskPhone', () => {
  it('hides the middle of a number', () => {
    expect(maskPhone('+923001234567')).toBe('+923*****67');
    expect(maskPhone('123')).toBe('123');
  });
});

describe('FND-031 normalizePkPhone accepts Pakistani mobile numbers in common forms and rejects the rest', () => {
  it.each([
    '03001234567',
    '+923001234567',
    '923001234567',
    '00923001234567',
    '0300 1234567',
    '0300-1234567',
    ' 0300 1234567 ',
    '+92 300 1234567',
    '3001234567',
    '+92 0300 1234567',
    '۰۳۰۰۱۲۳۴۵۶۷',
  ])('FND-031 accepts %p as +923001234567', (raw) => {
    expect(normalizePkPhone(raw)).toBe('+923001234567');
  });

  it.each([
    '0300123456',
    '030012345678',
    '+92300123456',
    '+9230012345678',
    '042 35761234',
    '04235761234',
    '+924235761234',
    '021-34567890',
    '',
    'abc',
    '0300-ABC-1234',
    '+44 7700 900123',
  ])('FND-031 refuses %p', (raw) => {
    expect(normalizePkPhone(raw)).toBeNull();
  });
});

describe('FND-032 formatPkPhone shows a stored number the way people write it', () => {
  it('FND-032 prints local by default, international and compact on request, and odd numbers as stored', () => {
    expect(formatPkPhone('+923001234567')).toBe('0300 1234567');
    expect(formatPkPhone('+923217654321')).toBe('0321 7654321');
    expect(formatPkPhone('042-35761234')).toBe('042-35761234');
    expect(formatPkPhone('')).toBe('');
    expect(formatPkPhone('+923001234567', 'international')).toBe('+92 300 1234567');
    expect(formatPkPhone('+923001234567', 'compact')).toBe('03001234567');
    expect(formatPkPhone('042-35761234', 'international')).toBe('042-35761234');
    expect(formatPkPhone('042-35761234', 'compact')).toBe('042-35761234');
  });
});
