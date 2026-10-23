/**
 * The customer page's templates (CUSTOMER_PAGE §6, §13; UX spec customer-and-inc23.md §1): every state's
 * HTML against its approved snapshot (`__snapshots__/page-render.spec.ts.snap`), and the rules every page
 * keeps: no script, no outside URL, the token only in links and forms, every value escaped, one h1,
 * `lang`/`dir`, the gas safety note last before the footer, the test strip off production only.
 */
import { formatPkDateTime } from '@smartfleet/shared-utils';
import {
  renderAlready,
  renderError,
  renderExpired,
  renderInactive,
  renderMain,
  renderNotFound,
  renderStep,
  renderThanks,
  renderTooMany,
  type PageLink,
} from '../../../src/modules/confirmation/page/pages';
import type { PageFrame } from '../../../src/modules/confirmation/page/templates';

const TOKEN = '3h7k9m2q4r6t8v0w1x5y7z9a2b';
const DELIVERED_AT = new Date('2026-10-22T11:12:00.000Z');
const TEST: PageFrame = { environment: 'test' };

function link(overrides: Partial<PageLink> = {}): PageLink {
  return {
    shop: 'Ahmed Gas',
    shopPhone: '+923211234567',
    orderNo: 'AG-0001',
    deliveredAt: DELIVERED_AT,
    expiresAt: new Date(DELIVERED_AT.getTime() + 72 * 3_600_000),
    delivered: [
      { size: '11.8 kg', count: 2 },
      { size: '45.4 kg', count: 1 },
    ],
    takenBack: [
      { size: '11.8 kg', state: 'EMPTY', count: 1, unlabelled: true },
      { size: '11.8 kg', state: 'PART_FILLED', count: 1, unlabelled: true },
    ],
    response: null,
    respondedAt: null,
    ...overrides,
  };
}

function text(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const answered = (response: 'YES' | 'PARTLY' | 'NO' | 'OTHER') =>
  link({ response, respondedAt: new Date('2026-10-22T11:20:00.000Z') });

/** Every page of CNF-009 step 1, by name. */
function allPages(): Record<string, string> {
  return {
    main: renderMain(link(), TOKEN, TEST),
    'main, nothing taken back': renderMain(link({ takenBack: [] }), TOKEN, TEST),
    'main, refused answer': renderMain(link(), TOKEN, TEST, { chooseError: true }),
    partly: renderStep('partly', link(), TOKEN, TEST),
    'not-received': renderStep('not-received', link(), TOKEN, TEST),
    other: renderStep('other', link(), TOKEN, TEST),
    'other, note missing': renderStep('other', link(), TOKEN, TEST, { noteError: true, comment: 'ok' }),
    'thank you YES': renderThanks(answered('YES'), 'YES', TEST),
    'thank you PARTLY': renderThanks(answered('PARTLY'), 'PARTLY', TEST),
    'thank you NO': renderThanks(answered('NO'), 'NO', TEST),
    'thank you OTHER': renderThanks(answered('OTHER'), 'OTHER', TEST),
    'already answered': renderAlready(answered('YES'), TEST),
    expired: renderExpired(link(), TEST),
    'no longer active': renderInactive(link(), TEST),
    'not found': renderNotFound('+923331234567', TEST),
    'not found, no support phone': renderNotFound(null, TEST),
    'too many tries': renderTooMany(1, TEST),
    'something went wrong': renderError(TEST, { token: TOKEN, link: link(), form: { answer: 'OTHER', comment: 'Valve is loose' } }),
  };
}

describe('CNF-009 Page HTML is right for every state, with no script', () => {
  const pages = allPages();

  it.each(Object.keys(pages))('CNF-009 %s matches its approved snapshot', (name) => {
    expect(pages[name]).toMatchSnapshot();
  });

  it('CNF-009 no page has a script; the only URLs are /c/<token> paths, tel: links and the data:, favicon', () => {
    for (const [name, html] of Object.entries(pages)) {
      expect({ name, script: /<script/i.test(html) }).toEqual({ name, script: false });
      const urls = [...html.matchAll(/(?:href|action|src)="([^"]*)"/g)].map((m) => m[1]);
      for (const url of urls) {
        expect({ name, url, ok: url === 'data:,' || url.startsWith('tel:') || url === `/c/${TOKEN}` || url.startsWith(`/c/${TOKEN}/`) }).toEqual({ name, url, ok: true });
      }
    }
  });

  it('CNF-009 the token appears only inside href and form action attributes', () => {
    for (const [name, html] of Object.entries(pages)) {
      const outside = html.replace(/(?:href|action)="[^"]*"/g, '');
      expect({ name, leaked: outside.includes(TOKEN) }).toEqual({ name, leaked: false });
    }
  });

  it('CNF-009 every page has lang and dir, exactly one h1, and the gas safety note as its last block before the footer', () => {
    for (const [name, html] of Object.entries(pages)) {
      expect({ name, head: html.startsWith('<!doctype html><html lang="en" dir="ltr">') }).toEqual({ name, head: true });
      expect({ name, h1: (html.match(/<h1[\s>]/g) ?? []).length }).toEqual({ name, h1: 1 });
      expect({ name, safetyLast: /<p class="safe" role="note">[^<]+<\/p>(<p class="f">Sent by Smart Fleet for [^<]+\.<\/p>)?<\/main><\/body><\/html>$/.test(html) }).toEqual({
        name,
        safetyLast: true,
      });
    }
    expect(pages['thank you YES']).toContain('aria-live="polite"');
  });

  it('CNF-009 the main page: the summary, "None" when nothing was taken back, the meta and the deadline', () => {
    const main = text(pages.main);
    expect(main).toContain('Delivered 2 × 11.8 kg 1 × 45.4 kg');
    expect(main).toContain('Taken back 1 × 11.8 kg Empty · no label 1 × 11.8 kg Part-filled · no label');
    expect(text(pages['main, nothing taken back'])).toContain('Taken back None');
    expect(main).toContain(`Order AG-0001 · ${formatPkDateTime(DELIVERED_AT)}`);
    expect(formatPkDateTime(DELIVERED_AT)).toBe('Thu 22 Oct, 4:12 pm');
    expect(main).toContain('Answer by Sun 25 Oct, 4:12 pm.');
    expect(main).toContain('Call Ahmed Gas · 0321 1234567');
    expect(main).toContain('Sent by Smart Fleet for Ahmed Gas.');
  });

  it('CNF-009 the thank-you lines', () => {
    expect(text(pages['thank you YES'])).toContain('We told Ahmed Gas you got everything.');
    expect(text(pages['thank you PARTLY'])).toContain('We told Ahmed Gas something was missing. They may call you.');
    expect(text(pages['thank you NO'])).toContain('We told Ahmed Gas you did not get it. They may call you.');
    expect(text(pages['thank you OTHER'])).toContain('We sent your message to Ahmed Gas. They may call you.');
  });

  it('CNF-009 staging shows the test strip; production has none', () => {
    const staging = renderMain(link(), TOKEN, { environment: 'staging' });
    const production = renderMain(link(), TOKEN, { environment: 'production' });
    expect(text(staging)).toContain('Test only · not a real delivery');
    expect(text(production)).not.toContain('Test only');
    expect(production).not.toContain('class="strip"');
  });
});

describe('CNF-010 Every value on the page is HTML-escaped', () => {
  const nasty = `Ahmed <b>Gas</b> & "Sons" 'x'`;
  const escaped = 'Ahmed &lt;b&gt;Gas&lt;/b&gt; &amp; &quot;Sons&quot; &#39;x&#39;';

  it('CNF-010 the shop name appears only escaped in the title, og:title, eyebrow, call row and footer', () => {
    for (const html of [renderMain(link({ shop: nasty }), TOKEN, TEST), renderStep('partly', link({ shop: nasty }), TOKEN, TEST)]) {
      expect(html).not.toContain('<b>Gas</b>');
      expect(html).not.toContain(nasty);
      expect(html).toContain(`<title>Confirm your delivery · ${escaped}</title>`);
      expect(html).toContain(`<meta property="og:title" content="Confirm your delivery from ${escaped}">`);
      expect(html).toContain(`Sent by Smart Fleet for ${escaped}.`);
      expect(html).not.toMatch(/<script/i);
    }
    const main = renderMain(link({ shop: nasty }), TOKEN, TEST);
    expect(main).toContain(`<p class="s">${escaped}</p>`);
    expect(main).toContain(`Call ${escaped} · 0321 1234567`);
    expect(renderStep('partly', link({ shop: nasty }), TOKEN, TEST)).toContain(`<p class="s">${escaped} · Order AG-0001</p>`);
  });

  it('CNF-010 the Other page re-shows a refused note escaped inside the textarea', () => {
    const note = '</textarea><script>alert(1)</script>';
    const html = renderStep('other', link(), TOKEN, TEST, { noteError: true, comment: note });
    expect(html).not.toMatch(/<script/i);
    expect(html.match(/<\/textarea>/g)).toHaveLength(1);
    expect(html).toContain('>&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;</textarea>');
  });
});
