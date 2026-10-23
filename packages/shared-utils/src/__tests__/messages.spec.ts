import { interpolate, renderMessage, toMessageParams } from '../messages';

describe('toMessageParams', () => {
  it('formats *Paisa keys and drops the suffix', () => {
    expect(toMessageParams({ requiredPaisa: '33000', balancePaisa: '12000', shortByPaisa: '21000' })).toEqual({
      requiredPaisa: '33000',
      balancePaisa: '12000',
      shortByPaisa: '21000',
      required: 'Rs 330',
      balance: 'Rs 120',
      shortBy: 'Rs 210',
    });
  });

  it('keeps other primitives and leaves out objects', () => {
    expect(toMessageParams({ count: 3, name: 'Ali Gas', ok: true, quote: { totalPaisa: '1' }, list: [1] })).toEqual({
      count: 3,
      name: 'Ali Gas',
      ok: true,
    });
  });

  it('skips Paisa keys that hold no amount', () => {
    expect(toMessageParams({ capPaisa: null, maxNowPaisa: 'n/a', Paisa: '100' })).toEqual({
      maxNowPaisa: 'n/a',
      Paisa: '100',
    });
    expect(toMessageParams(undefined)).toEqual({});
  });
});

describe('interpolate', () => {
  it('fills placeholders, with or without inner spaces', () => {
    expect(interpolate('Wait {{minutes}} minutes, {{ name }}.', { minutes: 5, name: 'Sana' })).toBe('Wait 5 minutes, Sana.');
  });

  it('leaves a missing parameter visible', () => {
    expect(interpolate('The minimum top-up is {{min}}.', {})).toBe('The minimum top-up is {{min}}.');
    expect(interpolate('Hi {{name}}', null)).toBe('Hi {{name}}');
  });
});

describe('renderMessage', () => {
  it('renders the API_CONTRACT §2.1 example', () => {
    const template = 'Not enough balance. This needs {{required}} and you have {{balance}}. Add money to continue.';
    expect(renderMessage(template, { requiredPaisa: '33000', balancePaisa: '12000', shortByPaisa: '21000' })).toBe(
      'Not enough balance. This needs Rs 330 and you have Rs 120. Add money to continue.',
    );
  });
});

describe('toMessageParams dates (API_CONTRACT §2.1, G09-06)', () => {
  it('shows a `date` or `…Date` key holding YYYY-MM-DD as "Tue 20 Oct", keeping other values as they are', () => {
    expect(toMessageParams({ sheetDate: '2026-10-20', date: '2026-10-21', updatedAt: '2026-10-21', note: '2026-10-21' })).toEqual({
      sheetDate: 'Tue 20 Oct',
      date: 'Wed 21 Oct',
      updatedAt: '2026-10-21',
      note: '2026-10-21',
    });
    expect(toMessageParams({ sheetDate: 'not a date', date: '2026-13-01' })).toEqual({ sheetDate: 'not a date', date: '2026-13-01' });
  });

  it('renders DAY_SHEET_WRONG_DATE with both days written for people', () => {
    expect(
      renderMessage('This sheet is for {{sheetDate}}. Upload the sheet for {{date}}.', { sheetDate: '2026-10-20', date: '2026-10-21' }),
    ).toBe('This sheet is for Tue 20 Oct. Upload the sheet for Wed 21 Oct.');
  });
});
