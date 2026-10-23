/**
 * The customer's confirmation page, `/c/:token` (CUSTOMER_PAGE §2-§7, API_CONTRACT §9.7, §9.11), built
 * to the simple design of the UX spec (customer-and-inc23.md §1, decided 2026-10-23). The copy checked
 * here is the design's (it replaces the older sentences the case texts quote, as that spec's §8 lists).
 */
import { gzipSync } from 'zlib';
import type { INestApplication } from '@nestjs/common';
import { formatPkDateTime } from '@smartfleet/shared-utils';
import { ConfirmationService, ConfirmationServiceImpl } from '../../../src/modules/confirmation/confirmation.interface';
import { RateLimitService, type RateLimitStore } from '../../../src/common/rate-limit/rate-limit.service';
import { confirmationTokenHash } from '../../../src/modules/confirmation/confirmation-token';
import { confirmationToken } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import type { StandardData } from '../../helpers/standard-data';
import {
  ageLink,
  auditRows,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  casesOf,
  clearPageLimits,
  confirmationOf,
  createConfirmApp,
  deliverX1,
  freshStandard,
  pageCalls,
  patchConfirmation,
  setSetting,
  textOf,
  waitForSends,
  type X1Delivery,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

const CYLINDER_NUMBER = /[A-Z][A-Z0-9]{1,5}-C[0-9]{4,}/;
const DA_PHONE = '0321 1234567';
const SAFETY = "Smell gas? Turn off the cylinder valve, open doors and windows, don't touch switches or flames, and call 1122.";
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** The gas safety note is the last block before the footer line (or before the end, on pages with no footer). */
function expectSafetyLast(html: string): void {
  expect(html).toMatch(/<p class="safe" role="note">[^<]+<\/p>(<p class="f">Sent by Smart Fleet for [^<]+\.<\/p>)?<\/main><\/body><\/html>$/);
  expect(textOf(html)).toContain(SAFETY);
}

function oneH1(html: string): void {
  expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  expect(html.startsWith('<!doctype html><html lang="en" dir="ltr">')).toBe(true);
}

describeDb('the confirmation page /c/:token', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const page = () => pageCalls(app);

  beforeAll(async () => {
    app = await createConfirmApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await waitForSends().catch(() => undefined);
    await app?.close();
  });

  beforeEach(async () => {
    std = await freshStandard(app);
  });

  async function delivered(count: number, opts: Parameters<typeof deliverX1>[2] = {}): Promise<X1Delivery[]> {
    const out: X1Delivery[] = [];
    for (let i = 0; i < count; i++) out.push(await deliverX1(app, std, opts));
    return out;
  }

  it('CNF-011 the page never shows personal data, money or cylinder numbers', async () => {
    await db().clientAddress.updateMany({ where: { clientId: std.C1.id }, data: { label: 'House 14, Street 5' } });
    const [d1] = await delivered(1, { takeBack118: 2 });
    const token = d1.token as string;
    const responses = [];
    for (const step of ['', '/partly', '/not-received', '/other']) responses.push(await page().get(token, step).expect(200));
    responses.push(await page().answer(token, 'NO').expect(303));
    responses.push(await page().get(token, '', { query: 'done=1' }).expect(200));
    responses.push(await page().get(token).expect(200));

    for (const res of responses) {
      const body = res.text.split(token).join('');
      for (const banned of ['Sana', '+923001234567', '03001234567', '0300 1234567', 'House 14', 'Rs ', '480', 'paisa']) {
        expect({ banned, found: body.includes(banned) }).toEqual({ banned, found: false });
      }
      expect(body).not.toMatch(CYLINDER_NUMBER);
      expect(res.headers['set-cookie']).toBeUndefined();
      if (body.includes('og:title')) {
        expect(body).toContain('<meta property="og:title" content="Confirm your delivery from Ahmed Gas">');
        expect(body).toContain('<meta property="og:description" content="Tap to tell us what you received.">');
      }
      expect(body).not.toContain('og:image');
      if (body.includes('tel:')) {
        expect(textOf(body)).toContain(DA_PHONE);
        expect(body).toContain('href="tel:+923211234567"');
      }
    }
    // The main page carries the preview tags.
    expect(responses[0].text).toContain('og:title');
  });

  it('CNF-012 opening the link never records an answer (previews, crawlers)', async () => {
    const [d1] = await delivered(1, { takeBack118: 2 });
    const token = d1.token as string;
    await page().get(token).expect(200);
    // HEAD: the GET page's status and headers with an empty body.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const supertest = require('supertest') as (server: unknown) => { head(url: string): { set(k: string, v: string): Promise<{ status: number; text?: string; headers: Record<string, string> }> } };
    const headRes = await supertest(app.getHttpServer()).head(`/c/${token}`).set('X-Forwarded-For', '203.0.113.99');
    expect(headRes.status).toBe(200);
    expect(headRes.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(headRes.text ?? '').toBe('');
    for (const userAgent of ['WhatsApp/2.23.20.0 A', 'facebookexternalhit/1.1', 'TelegramBot (like TwitterBot)', 'Googlebot/2.1', 'Slackbot-LinkExpanding 1.0']) {
      await page().get(token, '', { userAgent }).expect(200);
    }
    for (const step of ['/partly', '/not-received', '/other']) await page().get(token, step).expect(200);
    await page().get(token, '', { query: 'answer=YES' }).expect(200);
    const done = await page().get(token, '', { query: 'done=1' }).expect(200);
    expect(textOf(done.text)).toContain('Did you get your delivery?');
    expect(textOf(done.text)).not.toContain('Thank you!');

    const row = await confirmationOf(d1.order.id);
    expect(row).toMatchObject({ status: 'PENDING', response: null, respondedAt: null });
    expect(await auditRows('confirmation.answer')).toHaveLength(0);
    expect(await casesOf()).toHaveLength(0);
  });

  it('CNF-013 each of the four answers is recorded once with its own thank-you line', async () => {
    const [d1, d2, d3, d4] = await delivered(4);
    const [t1, t2, t3, t4] = [d1, d2, d3, d4].map((d) => d.token as string);

    // D1: All received, then the thank-you page twice (a refresh records nothing).
    const posted = await page().answer(t1, 'YES').expect(303);
    expect(posted.headers.location).toBe(`/c/${t1}?done=1`);
    const thanks = await page().path('get', posted.headers.location).expect(200);
    expect(textOf(thanks.text)).toContain('Thank you!');
    expect(textOf(thanks.text)).toContain('We told Ahmed Gas you got everything.');
    expect(thanks.text).toContain('aria-live="polite"');
    const firstAnswer = (await confirmationOf(d1.order.id))?.respondedAt;
    const again = await page().path('get', posted.headers.location).expect(200);
    expect(textOf(again.text)).toContain('We told Ahmed Gas you got everything.');
    expect((await confirmationOf(d1.order.id))?.respondedAt).toEqual(firstAnswer);

    // D2: Partly received, with its note.
    const partly = await page().get(t2, '/partly').expect(200);
    expect(textOf(partly.text)).toContain('Partly received');
    expect(textOf(partly.text)).toContain('What was missing? (optional)');
    const p2 = await page().answer(t2, 'PARTLY', 'Only one 11.8 kg cylinder came').expect(303);
    expect(p2.headers.location).toBe(`/c/${t2}?done=1`);
    expect(textOf((await page().path('get', p2.headers.location).expect(200)).text)).toContain(
      'We told Ahmed Gas something was missing. They may call you.',
    );

    // D3: Not received, with an empty note: its page has one red Send.
    const no = await page().get(t3, '/not-received').expect(200);
    expect(textOf(no.text)).toContain('Not received');
    expect(no.text).toContain('<button class="b dp">Send</button>');
    const p3 = await page().answer(t3, 'NO', '').expect(303);
    expect(p3.headers.location).toBe(`/c/${t3}?done=1`);
    expect(textOf((await page().path('get', p3.headers.location).expect(200)).text)).toContain(
      'We told Ahmed Gas you did not get it. They may call you.',
    );

    // D4: Other problem, straight from the main page's form fields.
    const p4 = await page().answer(t4, 'OTHER', 'Gas smell from the new cylinder').expect(303);
    expect(p4.headers.location).toBe(`/c/${t4}?done=1`);
    expect(textOf((await page().path('get', p4.headers.location).expect(200)).text)).toContain(
      'We sent your message to Ahmed Gas. They may call you.',
    );

    const rows = await Promise.all([d1, d2, d3, d4].map((d) => confirmationOf(d.order.id)));
    expect(rows.map((row) => [row?.status, row?.response, row?.comment])).toEqual([
      ['ANSWERED', 'YES', null],
      ['ANSWERED', 'PARTLY', 'Only one 11.8 kg cylinder came'],
      ['ANSWERED', 'NO', null],
      ['ANSWERED', 'OTHER', 'Gas smell from the new cylinder'],
    ]);
    for (const row of rows) expect(row?.respondedAt).toBeInstanceOf(Date);
    for (const d of [d1, d2, d3, d4]) expect(await auditRows('confirmation.answer', d.order.id)).toHaveLength(1);
  });

  it('CNF-014 incomplete or unknown answers are refused and nothing is recorded', async () => {
    const [d1] = await delivered(1, { takeBack118: 2 });
    const token = d1.token as string;
    // This case sends 8 posts to one link; the per-link limit (6 per 10 minutes, CNF-026) is cleared between steps.
    for (const comment of ['', 'ok', '  ok  ', '\u0007\u0007\u0007']) {
      await clearPageLimits();
      const res = await page().answer(token, 'OTHER', comment).expect(400);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.text).toContain('<p class="err" id="e" role="alert">Please write a few words.</p>');
      expect(res.text).toMatch(/<textarea id="n" name="comment" maxlength="300" aria-invalid="true" aria-describedby="e" autofocus>/);
      expect(textOf(res.text)).toContain('Other problem');
    }
    await clearPageLimits();
    const refused: Array<Record<string, string>> = [{ v: '1', answer: 'MAYBE' }, { v: '1' }, { v: '1', answer: 'yes' }];
    for (const fields of refused) {
      const res = await page().post(token, fields).expect(400);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.text).toContain('<p class="err" role="alert">Please tap one answer below.</p>');
      expect(textOf(res.text)).toContain('Did you get your delivery?');
    }
    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'PENDING', response: null });
    expect(await auditRows('confirmation.answer')).toHaveLength(0);
    expect(await casesOf()).toHaveLength(0);

    await clearPageLimits();
    const ok = await page().answer(token, 'OTHER', 'Gas').expect(303);
    expect(ok.headers.location).toBe(`/c/${token}?done=1`);
    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'ANSWERED', response: 'OTHER', comment: 'Gas' });
  });

  it('CNF-015 the note is cleaned and cut to 300 characters', async () => {
    const [d1, d2, d3, d4, d5] = await delivered(5);
    await page().answer(d1.token as string, 'OTHER', '  Cylinder\u0000 leaking\u001b near valve  ').expect(303);
    await page().answer(d2.token as string, 'PARTLY', 'a'.repeat(300)).expect(303);
    await page().answer(d3.token as string, 'PARTLY', `${'a'.repeat(300)}b`).expect(303);
    await page().answer(d4.token as string, 'NO', 'سلنڈر نہیں ملا').expect(303);
    await page().answer(d5.token as string, 'PARTLY', 'One came\nOne missing').expect(303);
    const comments = await Promise.all([d1, d2, d3, d4, d5].map(async (d) => (await confirmationOf(d.order.id))?.comment));
    expect(comments).toEqual(['Cylinder leaking near valve', 'a'.repeat(300), 'a'.repeat(300), 'سلنڈر نہیں ملا', 'One came One missing']);
  });

  it('CNF-016 the same answer sent again shows "Thank you" and records nothing new', async () => {
    const [d1] = await delivered(1, { takeBack118: 2 });
    const token = d1.token as string;
    await page().answer(token, 'YES').expect(303);
    const answeredAt = (await confirmationOf(d1.order.id))?.respondedAt;

    const again = await page().answer(token, 'YES').expect(303);
    expect(again.headers.location).toBe(`/c/${token}?done=1`);
    const thanks = await page().path('get', again.headers.location).expect(200);
    expect(textOf(thanks.text)).toContain('Thank you!');
    expect(textOf(thanks.text)).toContain('We told Ahmed Gas you got everything.');
    expect((await confirmationOf(d1.order.id))?.respondedAt).toEqual(answeredAt);
    expect(await auditRows('confirmation.answer', d1.order.id)).toHaveLength(1);
    expect(await casesOf()).toHaveLength(0);
  });

  it('CNF-017 a different second answer gets the friendly "already answered" page', async () => {
    const [d1] = await delivered(1, { takeBack118: 2 });
    const token = d1.token as string;
    await page().answer(token, 'YES').expect(303);
    // T1 = Thu 22 Oct, 4:20 pm in Pakistan.
    const t1 = new Date('2026-10-22T11:20:00.000Z');
    await patchConfirmation(d1.order.id, { respondedAt: t1 });

    for (const res of [await page().answer(token, 'NO').expect(409), await page().answer(token, 'OTHER', 'Actually one was missing').expect(409)]) {
      const text = textOf(res.text);
      expect(text).toContain('You already answered');
      expect(text).toContain(`You said: All received · ${formatPkDateTime(t1)}`);
      expect(formatPkDateTime(t1)).toBe('Thu 22 Oct, 4:20 pm');
      expect(text).toContain(`Wrong? Call Ahmed Gas · ${DA_PHONE}`);
    }
    const get = await page().get(token).expect(200);
    expect(textOf(get.text)).toContain(`You said: All received · ${formatPkDateTime(t1)}`);

    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'ANSWERED', response: 'YES', comment: null });
    expect(await auditRows('confirmation.answer', d1.order.id)).toHaveLength(1);
    expect(await casesOf()).toHaveLength(0);
  });

  it('CNF-018 two answers at the same moment leave exactly one winner', async () => {
    const [d1, d2] = await delivered(2);
    // The race is the subject: the per-link post limit (6 per 10 minutes) is set aside for its 10 posts.
    const limiter = app.get(RateLimitService);
    const original = limiter['store'];
    const allowAll: RateLimitStore = { eval: async () => 1 };
    limiter.useStore(allowAll);
    try {
      const posts = await Promise.all([
        ...Array.from({ length: 5 }, () => page().answer(d1.token as string, 'YES')),
        ...Array.from({ length: 5 }, () => page().answer(d1.token as string, 'NO')),
      ]);
      const winner = (await confirmationOf(d1.order.id))?.response;
      expect(['YES', 'NO']).toContain(winner);
      posts.forEach((res, i) => {
        const answer = i < 5 ? 'YES' : 'NO';
        expect(res.status).toBe(answer === winner ? 303 : 409);
        if (res.status === 409) {
          expect(textOf(res.text)).toContain('You already answered');
          expect(textOf(res.text)).toContain(`You said: ${winner === 'YES' ? 'All received' : 'Not received'} · `);
        }
      });
      const second = await Promise.all([page().answer(d2.token as string, 'YES'), page().answer(d2.token as string, 'OTHER', 'Leak')]);
      const winner2 = (await confirmationOf(d2.order.id))?.response;
      expect(second.map((res) => res.status).sort()).toEqual([303, 409]);
      expect(second[winner2 === 'YES' ? 0 : 1].status).toBe(303);
      for (const res of [...posts, ...second]) expect(res.status).not.toBe(500);
      const done = await page().get(d1.token as string, '', { query: 'done=1' }).expect(200);
      expect(textOf(done.text)).toContain('Thank you!');

      for (const [d, win] of [
        [d1, winner],
        [d2, winner2],
      ] as const) {
        expect(await confirmationOf(d.order.id)).toMatchObject({ status: 'ANSWERED' });
        expect(await auditRows('confirmation.answer', d.order.id)).toHaveLength(1);
        expect(await casesOf(d.order.id)).toHaveLength(win === 'NO' || win === 'OTHER' ? 1 : 0);
      }
    } finally {
      limiter.useStore(original as RateLimitStore);
    }
  });

  it('CNF-019 state pages, their HTTP codes and the exact expiry moment', async () => {
    const [a, b, c, d, e, f] = await delivered(6);
    await page().answer(a.token as string, 'YES').expect(303);
    // D is closed by the job; C and B are moved afterwards, so the job never sees them.
    await ageLink(d.order.id, new Date(Date.now() - 60_000));
    expect(await app.get(ConfirmationService).expireDue()).toBe(1);
    expect((await confirmationOf(d.order.id))?.status).toBe('EXPIRED');
    await ageLink(b.order.id, new Date(Date.now() + 2_500));
    // B: the main page now (its expiry is moments away)...
    const bNow = await page().get(b.token as string).expect(200);
    expect(textOf(bNow.text)).toContain('Did you get your delivery?');
    await ageLink(c.order.id, new Date());
    await patchConfirmation(e.order.id, { status: 'CANCELLED' });
    await page().answer(f.token as string, 'YES').expect(303);
    await ageLink(f.order.id, new Date(Date.now() - 60_000));
    const auditBefore = (await auditRows('confirmation.answer')).length;

    // A: answered.
    const aGet = await page().get(a.token as string).expect(200);
    expect(textOf(aGet.text)).toContain('You already answered');
    await page().answer(a.token as string, 'YES').expect(303);
    // ...and expired once its moment passes (before any job run).
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const bLater = await page().get(b.token as string).expect(410);
    expect(textOf(bLater.text)).toContain('This link has expired');
    await page().answer(b.token as string, 'YES').expect(410);
    expect((await confirmationOf(b.order.id))?.status).toBe('PENDING');
    // C and D: expired, each naming its own order and the link's lifetime.
    for (const link of [c, d]) {
      for (const res of [await page().get(link.token as string).expect(410), await page().answer(link.token as string, 'YES').expect(410)]) {
        const text = textOf(res.text);
        expect(text).toContain('This link has expired');
        expect(text).toContain('Answers close 3 days after delivery.');
        expect(text).toContain(`Ahmed Gas · Order ${link.order.shortCode}`);
        expect(text).toContain(`Problem? Call Ahmed Gas · ${DA_PHONE}`);
        expectSafetyLast(res.text);
        oneH1(res.text);
      }
    }
    expect((await confirmationOf(c.order.id))?.status).toBe('PENDING');
    // E: cancelled (reserved; set in the database).
    for (const res of [await page().get(e.token as string).expect(410), await page().answer(e.token as string, 'YES').expect(410)]) {
      const text = textOf(res.text);
      expect(text).toContain('This link is closed');
      expect(text).toContain('No answer is needed.');
      expect(text).toContain(`Ahmed Gas · Order ${e.order.shortCode}`);
      expect(text).toContain(`Questions? Call Ahmed Gas · ${DA_PHONE}`);
      expectSafetyLast(res.text);
    }
    // F: answered is checked before expired.
    const fGet = await page().get(f.token as string).expect(200);
    expect(textOf(fGet.text)).toContain('You already answered');
    await page().answer(f.token as string, 'YES').expect(303);
    expect((await auditRows('confirmation.answer')).length).toBe(auditBefore);

    // Step 3: the second-step pages follow the same state order and never show the form.
    for (const step of ['/partly', '/other']) {
      const res = await page().get(a.token as string, step).expect(200);
      expect(textOf(res.text)).toContain('You already answered');
      expect(res.text).not.toContain('<textarea');
      expectSafetyLast(res.text);
    }
    for (const step of ['/partly', '/not-received']) {
      const res = await page().get(d.token as string, step).expect(410);
      expect(textOf(res.text)).toContain('This link has expired');
      expect(res.text).not.toContain('<textarea');
      expectSafetyLast(res.text);
    }
    expectSafetyLast(aGet.text);
    expectSafetyLast(fGet.text);
  });

  it('CNF-023 unknown or broken links show a not-found page that leaks nothing', async () => {
    const [d1] = await delivered(1, { takeBack118: 2 });
    const token = d1.token as string;
    // T0: D1's token before a new link.
    const row = await confirmationOf(d1.order.id);
    const t0 = token;
    const t2 = confirmationToken(row!.id, 2);
    await patchConfirmation(d1.order.id, { tokenVersion: 2, tokenHash: confirmationTokenHash(t2) });
    await setSetting(app, 'support.phone', '+923331234567', 'Support number for the link page');
    // Warm the settings cache, then count the confirmation lookups.
    await page().get('warm').expect(404);
    const lookups = jest.spyOn(app.get(ConfirmationServiceImpl), 'findLink');

    const never = 'abcdefghjkmnpqrstvwxyz0123';
    const badFormat = ['abc', 'a'.repeat(25), 'a'.repeat(27), 'a'.repeat(65)];
    const bodies: string[] = [];
    for (const bad of badFormat) bodies.push((await page().get(bad).expect(404)).text);
    expect(lookups).not.toHaveBeenCalled();
    bodies.push((await page().get(never).expect(404)).text);
    bodies.push((await page().get(t0).expect(404)).text);
    bodies.push((await page().get(`abcde%3Cscript%3Efghjkmnpqrstv`).expect(404)).text);
    bodies.push((await page().answer(never, 'YES').expect(404)).text);
    for (const body of bodies) {
      expect(body).toBe(bodies[0]);
      const text = textOf(body);
      expect(text).toContain("We can't find this link");
      expect(text).toContain('Open the full link in your newest message.');
      expect(text).toContain('Call Smart Fleet support · 0333 1234567');
      expect(body).toContain('href="tel:+923331234567"');
      for (const leak of [token, t0, never, 'Ahmed Gas', 'AG-0001', '<script', 'stack', '{"']) expect(body).not.toContain(leak);
      expectSafetyLast(body);
    }

    // Step 3: other paths and methods under /c/, with no lookup.
    lookups.mockClear();
    const other = await page().get(t2, '/unknown-step').expect(404);
    const postStep = await page().path('post', `/c/${t2}/partly`).expect(404);
    expect(other.text).toBe(bodies[0]);
    expect(postStep.text).toBe(bodies[0]);
    expect(lookups).not.toHaveBeenCalled();
    lookups.mockRestore();

    // Step 4: the page is not part of the API.
    const api = await page().path('get', `/api/v1/c/${t2}`).expect(404);
    expect(api.body).toMatchObject({ code: 'NOT_FOUND', path: '/api/v1/c/[token]' });
    const apiPost = await page().path('post', `/api/v1/c/${t2}`).expect(404);
    expect(apiPost.body).toMatchObject({ code: 'NOT_FOUND', path: '/api/v1/c/[token]' });
    expect(JSON.stringify(api.body)).not.toContain(t2);
    expect((await confirmationOf(d1.order.id))?.status).toBe('PENDING');

    // Step 5: without support.phone the support row is left out.
    await setSetting(app, 'support.phone', null, 'Support number removed for the test');
    const bare = await page().get('abc').expect(404);
    const text = textOf(bare.text);
    expect(text).toContain('Open the full link in your newest message.');
    expect(text).not.toContain('Call Smart Fleet support');
    expect(bare.text).not.toContain('tel:');
    expect(text).not.toMatch(/\{|\}/);
  });

  it('CNF-024 a link typed in capitals or with look-alike letters still opens', async () => {
    const [d1] = await delivered(1, { takeBack118: 2 });
    const row = (await confirmationOf(d1.order.id))!;
    // Re-issue the token until it has at least one 0 and one 1.
    let version = row.tokenVersion;
    let token = confirmationToken(row.id, version);
    while (!(token.includes('0') && token.includes('1'))) token = confirmationToken(row.id, ++version);
    await patchConfirmation(d1.order.id, { tokenVersion: version, tokenHash: confirmationTokenHash(token) });

    const upper = token.toUpperCase();
    const lookAlike = token.replace(/0/g, 'O').replace(/1/g, (_m, i: number) => (i % 2 === 0 ? 'l' : 'I'));
    const hyphens = token.replace(/(.{5})(?=.)/g, '$1-');
    expect(hyphens.length).toBe(31);
    for (const variant of [upper, lookAlike, hyphens]) {
      const res = await page().get(variant).expect(200);
      expect(textOf(res.text)).toContain('Did you get your delivery?');
      expect(textOf(res.text)).toContain(`Order ${d1.order.shortCode}`);
    }
    await page().answer(upper, 'YES').expect(303);
    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'ANSWERED', response: 'YES' });
  });

  it('CNF-027 every link-page response carries the safety headers', async () => {
    const [main, answered, expired, cancelled, forced, limited] = await delivered(6, { takeBack118: 2 });
    await ageLink(expired.order.id, new Date(Date.now() - 60_000));
    await patchConfirmation(cancelled.order.id, { status: 'CANCELLED' });
    const responses = [];
    responses.push(await page().get(main.token as string).expect(200));
    const post = await page().answer(answered.token as string, 'YES').expect(303);
    responses.push(post);
    responses.push(await page().path('get', post.headers.location).expect(200));
    responses.push(await page().answer(main.token as string, 'OTHER', '').expect(400));
    responses.push(await page().get('abcdefghjkmnpqrstvwxyz0123').expect(404));
    responses.push(await page().get(expired.token as string).expect(410));
    responses.push(await page().get(cancelled.token as string).expect(410));
    for (let i = 0; i < 6; i++) await page().answer(limited.token as string, 'OTHER', 'x').expect(400);
    const tooMany = await page().answer(limited.token as string, 'YES').expect(429);
    expect(tooMany.headers['retry-after']).toMatch(/^\d+$/);
    responses.push(tooMany);
    const record = jest.spyOn(app.get(ConfirmationServiceImpl), 'record').mockRejectedValueOnce(new Error('forced failure'));
    responses.push(await page().answer(forced.token as string, 'YES').expect(500));
    record.mockRestore();

    for (const res of responses) {
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe(CSP);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.text.trim().startsWith('{')).toBe(false);
    }
  });

  it('CNF-031 the page stays under 12 KB and loads nothing from outside', async () => {
    await db().distributor.update({ where: { id: std.DA.id }, data: { businessName: 'Ahmed Gas Lahore Ltd' } });
    const [d1] = await delivered(1, {
      lines: [
        { size: 'kg11_8', count: 1, expectedReturnCount: 1 },
        { size: 'kg15', count: 1, expectedReturnCount: 1 },
        { size: 'kg45_4', count: 1, expectedReturnCount: 1 },
      ],
      feePaisa: 52_000n,
      unlabelled: [
        { size: 'kg11_8', state: 'EMPTY', count: 1 },
        { size: 'kg11_8', state: 'PART_FILLED', count: 1 },
        { size: 'kg15', state: 'FULL', count: 1 },
        { size: 'kg45_4', state: 'EMPTY', count: 1 },
      ],
    });
    const token = d1.token as string;
    const res = await page().get(token).expect(200);
    const bytes = Buffer.byteLength(res.text, 'utf8');
    const gzipped = gzipSync(Buffer.from(res.text, 'utf8')).length;
    console.log(`[CNF-031] main page: ${bytes} bytes, ${gzipped} bytes gzipped`);
    expect(bytes).toBeLessThanOrEqual(12_288);
    expect(res.text).not.toMatch(/<script/i);
    expect(res.text).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    expect(res.text).not.toMatch(/@font-face|@import|url\(/i);
    expect(res.text).not.toMatch(/<img(?![^>]*src="data:)/i);
    expect(res.text).toContain('<link rel="icon" href="data:,">');
    const urls = [...res.text.matchAll(/(?:href|action|src)="([^"]*)"/g)].map((m) => m[1]);
    for (const url of urls) expect(url === 'data:,' || url.startsWith('tel:') || url.startsWith(`/c/${token}`)).toBe(true);
    expect(res.headers['set-cookie']).toBeUndefined();

    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const started = process.hrtime.bigint();
      await page().get(token).expect(200);
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    times.sort((x, y) => x - y);
    const p95 = times[94];
    console.log(`[CNF-031] 100 GETs on this machine: p95 ${p95.toFixed(1)} ms, median ${times[49].toFixed(1)} ms`);
    expect(p95).toBeLessThanOrEqual(150);
  });

  it('CNF-046 a server error page lets the customer send the same answer again', async () => {
    const [d1] = await delivered(1, { takeBack118: 2 });
    const token = d1.token as string;
    const record = jest.spyOn(app.get(ConfirmationServiceImpl), 'record').mockRejectedValueOnce(new Error('database error'));
    const failed = await page().answer(token, 'OTHER', 'Valve is loose').expect(500);
    record.mockRestore();
    const text = textOf(failed.text);
    expect(text).toContain('Something went wrong');
    expect(text).toContain('Your answer was not saved.');
    expect(failed.text).not.toMatch(/at \w+ \(|Error:|"statusCode"/);
    expect(failed.headers['content-type']).toBe('text/html; charset=utf-8');
    const form = /<form method="post" action="([^"]+)"[^>]*>(.*?)<\/form>/.exec(failed.text);
    expect(form).not.toBeNull();
    expect(form![1]).toBe(`/c/${token}`);
    const fields = Object.fromEntries([...form![2].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2]]));
    expect(fields).toEqual({ v: '1', answer: 'OTHER', comment: 'Valve is loose' });
    expect(form![2]).toContain('Try again');
    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'PENDING' });
    expect(await auditRows('confirmation.answer')).toHaveLength(0);

    const retried = await page().post(token, fields).expect(303);
    const thanks = await page().path('get', retried.headers.location).expect(200);
    expect(textOf(thanks.text)).toContain('Thank you!');
    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'ANSWERED', response: 'OTHER', comment: 'Valve is loose' });
    expect(await auditRows('confirmation.answer', d1.order.id)).toHaveLength(1);
    expect(await casesOf(d1.order.id)).toHaveLength(1);
  });
});
