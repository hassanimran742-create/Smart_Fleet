import {
  addDays,
  businessDate,
  businessDayRange,
  FORMAT_WHEN_EN,
  FORMAT_WHEN_KEYS,
  formatClock,
  formatDayLabel,
  formatIsoDay,
  formatPkDateTime,
  formatPkDay,
  formatPkTime,
  formatWhen,
  isIsoDate,
  localDate,
  timeZoneOffsetMinutes,
  wallClock,
  type WhenTranslate,
} from '../time';

// 2025-10-21 is a Tuesday. 11:12 UTC is 4:12 pm in Karachi (UTC+5).
const NOW = '2025-10-21T12:00:00.000Z';

describe('Karachi formatting', () => {
  it('prints times in 12-hour form', () => {
    expect(formatPkTime('2025-10-21T11:12:00Z')).toBe('4:12 pm');
    expect(formatPkTime('2025-10-20T19:05:00Z')).toBe('12:05 am');
    expect(formatPkTime('2025-10-21T07:30:00Z')).toBe('12:30 pm');
    expect(formatPkTime('2025-10-21T04:05:00Z')).toBe('9:05 am');
  });

  it('prints days', () => {
    expect(formatPkDay('2025-10-21T11:12:00Z')).toBe('Tue 21 Oct');
    expect(formatPkDay('2025-10-21T11:12:00Z', { weekday: false })).toBe('21 Oct');
    expect(formatPkDay('2025-10-21T11:12:00Z', { year: true })).toBe('Tue 21 Oct 2025');
  });

  it('prints date and time like the customer page', () => {
    expect(formatPkDateTime('2025-10-21T11:12:00Z')).toBe('Tue 21 Oct, 4:12 pm');
    expect(formatPkDateTime(new Date('2025-10-24T11:12:00Z'))).toBe('Fri 24 Oct, 4:12 pm');
    expect(formatPkDateTime(Date.parse('2025-10-21T11:12:00Z'), { weekday: false })).toBe('21 Oct, 4:12 pm');
  });

  it('uses the Karachi calendar day, not UTC', () => {
    expect(formatPkDay('2025-10-20T19:30:00Z')).toBe('Tue 21 Oct');
    expect(localDate('2025-10-20T19:30:00Z')).toBe('2025-10-21');
    expect(localDate('2025-10-20T18:59:59Z')).toBe('2025-10-20');
  });

  it('needs no Intl for Asia/Karachi', () => {
    const globals = globalThis as { Intl?: unknown };
    const realIntl = globals.Intl;
    globals.Intl = undefined;
    try {
      expect(formatPkDateTime('2025-10-21T11:12:00Z')).toBe('Tue 21 Oct, 4:12 pm');
      expect(formatWhen('2025-10-21T11:12:00Z', NOW)).toBe('Today, 4:12 pm');
      expect(businessDate('2025-10-21T21:59:00Z')).toBe('2025-10-21');
      expect(timeZoneOffsetMinutes(NOW)).toBe(300);
    } finally {
      globals.Intl = realIntl;
    }
  });

  it('refuses invalid times', () => {
    expect(() => formatPkTime('not a time')).toThrow(RangeError);
  });

  it('exposes the wall clock', () => {
    expect(wallClock('2025-10-21T11:12:30Z')).toEqual({
      year: 2025,
      month: 10,
      day: 21,
      hour: 16,
      minute: 12,
      second: 30,
      weekday: 2,
    });
  });
});

describe('formatClock (setting times for people, UX_PRINCIPLES §5.1)', () => {
  it('prints whole hours without minutes, in 12-hour form', () => {
    expect(formatClock('21:00')).toBe('9 pm');
    expect(formatClock('09:00')).toBe('9 am');
    expect(formatClock('03:00')).toBe('3 am');
    expect(formatClock('10:00')).toBe('10 am');
  });

  it('keeps the minutes when they are not :00', () => {
    expect(formatClock('21:30')).toBe('9:30 pm');
    expect(formatClock('09:05')).toBe('9:05 am');
    expect(formatClock('23:59')).toBe('11:59 pm');
  });

  it('says 12 am at midnight and 12 pm at noon', () => {
    expect(formatClock('00:00')).toBe('12 am');
    expect(formatClock('00:30')).toBe('12:30 am');
    expect(formatClock('12:00')).toBe('12 pm');
    expect(formatClock('12:45')).toBe('12:45 pm');
  });

  it('words the website day-start choices "12 am" to "6 am"', () => {
    expect(['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00'].map(formatClock)).toEqual([
      '12 am',
      '1 am',
      '2 am',
      '3 am',
      '4 am',
      '5 am',
      '6 am',
    ]);
  });

  it('reads a one-digit hour too', () => {
    expect(formatClock('9:00')).toBe('9 am');
    expect(formatClock('9:30')).toBe('9:30 am');
  });

  it('returns anything that is not a time of day unchanged', () => {
    for (const value of ['24:00', '21:60', '21', '9 pm', '', 'nine', '021:00', '21:5']) {
      expect(formatClock(value)).toBe(value);
    }
    expect(formatClock(undefined as unknown as string)).toBeUndefined();
  });

  it('needs no Intl and ignores the time zone', () => {
    const globals = globalThis as { Intl?: unknown };
    const realIntl = globals.Intl;
    globals.Intl = undefined;
    try {
      expect(formatClock('21:00')).toBe('9 pm');
    } finally {
      globals.Intl = realIntl;
    }
  });
});

describe('formatWhen and formatDayLabel', () => {
  it('says Today and Yesterday by Karachi calendar day', () => {
    expect(formatWhen('2025-10-21T11:12:00Z', NOW)).toBe('Today, 4:12 pm');
    expect(formatWhen('2025-10-20T19:30:00Z', NOW)).toBe('Today, 12:30 am');
    expect(formatWhen('2025-10-20T18:59:00Z', NOW)).toBe('Yesterday, 11:59 pm');
    expect(formatWhen('2025-10-20T04:05:00Z', NOW)).toBe('Yesterday, 9:05 am');
  });

  it('falls back to the day and time', () => {
    expect(formatWhen('2025-10-19T11:12:00Z', NOW)).toBe('Sun 19 Oct, 4:12 pm');
    expect(formatWhen('2025-10-23T11:12:00Z', NOW)).toBe('Thu 23 Oct, 4:12 pm');
    expect(formatWhen('2024-12-31T10:00:00Z', NOW)).toBe('Tue 31 Dec 2024, 3:00 pm');
  });

  it('asks the translator for Today and Yesterday', () => {
    const t: WhenTranslate = (key, options) => `${key}|${options?.time ?? ''}`;
    expect(formatWhen('2025-10-21T11:12:00Z', NOW, t)).toBe('common.when.today|4:12 pm');
    expect(formatWhen('2025-10-20T04:05:00Z', NOW, t)).toBe('common.when.yesterday|9:05 am');
    expect(formatDayLabel('2025-10-21T11:12:00Z', NOW, t)).toBe('common.day.today|');
    expect(formatDayLabel('2025-10-20T04:05:00Z', NOW, t)).toBe('common.day.yesterday|');
  });

  it('labels day sections', () => {
    expect(formatDayLabel('2025-10-21T01:00:00Z', NOW)).toBe('Today');
    expect(formatDayLabel('2025-10-20T01:00:00Z', NOW)).toBe('Yesterday');
    expect(formatDayLabel('2025-10-19T01:00:00Z', NOW)).toBe('Sun 19 Oct');
    expect(formatDayLabel('2024-10-19T01:00:00Z', NOW)).toBe('Sat 19 Oct 2024');
  });

  it('publishes its keys and English', () => {
    expect(FORMAT_WHEN_KEYS.today).toBe('common.when.today');
    expect(FORMAT_WHEN_EN.when.yesterday).toBe('Yesterday, {{time}}');
  });
});

describe('businessDate', () => {
  it('starts the Karachi business day at 03:00', () => {
    expect(businessDate('2025-10-21T21:59:00Z')).toBe('2025-10-21'); // 02:59 on the 22nd
    expect(businessDate('2025-10-21T22:00:00Z')).toBe('2025-10-22'); // 03:00 on the 22nd
    expect(businessDate('2025-10-21T19:00:00Z')).toBe('2025-10-21'); // midnight
    expect(businessDate(new Date('2025-10-21T11:12:00Z'))).toBe('2025-10-21');
  });

  it('takes the day settings', () => {
    expect(businessDate('2025-10-21T19:00:00Z', { cutoffLocalTime: '00:00' })).toBe('2025-10-22');
    expect(businessDate('2025-10-21T02:59:00Z', { timezone: 'UTC' })).toBe('2025-10-20');
    expect(businessDate('2025-10-21T02:59:00Z', { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' })).toBe('2025-10-21');
  });

  it('handles daylight-saving zones through Intl', () => {
    expect(businessDate('2025-10-21T01:30:00Z', { timezone: 'Europe/London' })).toBe('2025-10-20'); // 02:30 BST
    expect(businessDate('2025-10-21T02:30:00Z', { timezone: 'Europe/London' })).toBe('2025-10-21'); // 03:30 BST
    expect(businessDate('2025-10-27T02:30:00Z', { timezone: 'Europe/London' })).toBe('2025-10-26'); // 02:30 GMT
  });

  it('refuses bad settings', () => {
    expect(() => businessDate(NOW, { cutoffLocalTime: '3:00' })).toThrow(RangeError);
    expect(() => businessDate(NOW, { cutoffLocalTime: '24:00' })).toThrow(RangeError);
    expect(() => businessDate(NOW, { timezone: 'Mars/Base' })).toThrow(RangeError);
  });
});

describe('businessDayRange', () => {
  it('bounds a Karachi business day by its cut-offs', () => {
    const range = businessDayRange('2025-10-21');
    expect(range.start.toISOString()).toBe('2025-10-20T22:00:00.000Z');
    expect(range.end.toISOString()).toBe('2025-10-21T22:00:00.000Z');
    expect(businessDate(range.start)).toBe('2025-10-21');
    expect(businessDate(range.end.getTime() - 1)).toBe('2025-10-21');
    expect(businessDate(range.end)).toBe('2025-10-22');
  });

  it('follows daylight-saving changes', () => {
    const long = businessDayRange('2025-10-25', { timezone: 'Europe/London' });
    expect(long.start.toISOString()).toBe('2025-10-25T02:00:00.000Z');
    expect(long.end.toISOString()).toBe('2025-10-26T03:00:00.000Z');
    const after = businessDayRange('2025-10-26', { timezone: 'Europe/London' });
    expect(after.start.toISOString()).toBe('2025-10-26T03:00:00.000Z');
  });

  it('refuses a bad date', () => {
    expect(() => businessDayRange('2025-02-29')).toThrow(RangeError);
    expect(() => businessDayRange('21/10/2025')).toThrow(RangeError);
  });
});

describe('calendar dates', () => {
  it('checks real dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2025-1-01')).toBe(false);
    expect(isIsoDate(20251021)).toBe(false);
  });

  it('adds days across months and years', () => {
    expect(addDays('2025-10-21', -7)).toBe('2025-10-14');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(() => addDays('2025-13-01', 1)).toThrow(RangeError);
  });
});

describe('FND-028 formatWhen shows Karachi time as Today, Yesterday or a short date', () => {
  // Thu 22 Oct 2026, 6:00 pm in Karachi.
  const now = '2026-10-22T13:00:00Z';
  const cases: [string, string][] = [
    ['2026-10-22T11:12:00Z', 'Today, 4:12 pm'],
    ['2026-10-21T04:05:00Z', 'Yesterday, 9:05 am'],
    ['2026-10-19T11:12:00Z', 'Mon 19 Oct, 4:12 pm'],
    ['2026-10-21T19:30:00Z', 'Today, 12:30 am'],
    ['2026-10-21T18:59:59Z', 'Yesterday, 11:59 pm'],
    ['2026-10-22T07:00:00Z', 'Today, 12:00 pm'],
    ['2025-10-19T11:12:00Z', 'Sun 19 Oct 2025, 4:12 pm'],
    ['2026-10-23T05:00:00Z', 'Fri 23 Oct, 10:00 am'],
  ];
  const englishT: WhenTranslate = (key, options) =>
    key === FORMAT_WHEN_KEYS.today
      ? FORMAT_WHEN_EN.when.today.replace('{{time}}', options?.time ?? '')
      : key === FORMAT_WHEN_KEYS.yesterday
        ? FORMAT_WHEN_EN.when.yesterday.replace('{{time}}', options?.time ?? '')
        : key;

  it.each(['Europe/London', 'America/New_York'])(
    'FND-028 gives the same Karachi words under TZ=%s with Intl unavailable (Hermes)',
    (zone) => {
      const globals = globalThis as { Intl?: unknown };
      const realIntl = globals.Intl;
      const realTz = process.env.TZ;
      process.env.TZ = zone;
      globals.Intl = new Proxy(
        {},
        {
          get() {
            throw new Error('Intl is not available on this device');
          },
        },
      );
      try {
        for (const [at, expected] of cases) {
          expect({ at, words: formatWhen(at, now, englishT) }).toEqual({ at, words: expected });
          expect({ at, words: formatWhen(at, now) }).toEqual({ at, words: expected });
        }
      } finally {
        globals.Intl = realIntl;
        if (realTz === undefined) delete process.env.TZ;
        else process.env.TZ = realTz;
      }
    },
  );
});

describe('FND-029 businessDate uses Asia/Karachi with the 03:00 cut-off, including the midnight edges', () => {
  it.each<[string, string]>([
    ['2026-10-21T18:59:59Z', '2026-10-21'],
    ['2026-10-21T19:00:00Z', '2026-10-21'],
    ['2026-10-21T21:59:59Z', '2026-10-21'],
    ['2026-10-21T22:00:00Z', '2026-10-22'],
    ['2026-12-31T21:30:00Z', '2026-12-31'],
    ['2026-12-31T22:30:00Z', '2027-01-01'],
  ])('FND-029 %s is business date %s', (at, date) => {
    expect(businessDate(at)).toBe(date);
    expect(businessDate(at, { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' })).toBe(date);
  });

  it('FND-029 with a 00:00 cut-off, midnight starts the next day', () => {
    expect(businessDate('2026-10-21T19:00:00Z', { cutoffLocalTime: '00:00' })).toBe('2026-10-22');
  });

  it('FND-029 the cut-off moment of business date 2026-10-21 is 03:00 on 22 Oct in Karachi', () => {
    expect(businessDayRange('2026-10-21').end.toISOString()).toBe('2026-10-21T22:00:00.000Z');
    expect(businessDayRange('2026-10-21').start.toISOString()).toBe('2026-10-20T22:00:00.000Z');
  });
});

describe('formatIsoDay (API_CONTRACT §2.1, G09-06)', () => {
  it('prints a plain calendar date with its weekday and no time zone', () => {
    expect(formatIsoDay('2026-10-20')).toBe('Tue 20 Oct');
    expect(formatIsoDay('2026-10-21')).toBe('Wed 21 Oct');
    expect(formatIsoDay('2027-01-01', { year: true })).toBe('Fri 1 Jan 2027');
    expect(formatIsoDay('2024-02-29')).toBe('Thu 29 Feb');
  });

  it('needs no Intl and leaves anything that is not a real date unchanged', () => {
    const globals = globalThis as { Intl?: unknown };
    const realIntl = globals.Intl;
    globals.Intl = undefined;
    try {
      expect(formatIsoDay('2026-10-20')).toBe('Tue 20 Oct');
    } finally {
      globals.Intl = realIntl;
    }
    expect(formatIsoDay('2026-02-30')).toBe('2026-02-30');
    expect(formatIsoDay('20 Oct')).toBe('20 Oct');
  });
});
