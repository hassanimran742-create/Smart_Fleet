/**
 * The customer page's pages (CUSTOMER_PAGE §4-§6, built to the simple design of UX spec
 * customer-and-inc23.md §1 as decided on 2026-10-23): the main page, the three second-step pages, thank
 * you, and the already answered, expired, closed, not found, too many tries and something went wrong
 * pages. Each returns a whole HTML document; the controller and the error filter send it with its status
 * and headers.
 *
 * What a page never shows: the customer's name, address, any price or money, cylinder numbers, the
 * requested path, or a stack trace. The token appears only in `href` and `action` attributes.
 */
import type { ConfirmationResponse } from '@smartfleet/shared-types';
import { formatPkDateTime } from '@smartfleet/shared-utils';
import { confirmationPath } from '../confirmation-links';
import type { IconName } from './icons';
import { icon } from './icons';
import { t, type ConfirmPageKey } from './messages.en';
import {
  buttonForm,
  buttonLink,
  callRow,
  commentField,
  escapeHtml,
  eyebrow,
  layout,
  statusMark,
  textLink,
  type PageFrame,
} from './templates';

/** What the page knows about a link once its token was found (the frozen snapshot plus the row's state). */
export interface PageLink {
  shop: string;
  /** The shop's phone (E.164 for the pilot: the distributor's login phone), or null. */
  shopPhone: string | null;
  orderNo: string;
  deliveredAt: Date;
  expiresAt: Date;
  delivered: { size: string; count: number }[];
  takenBack: { size: string; state: string; count: number; unlabelled: boolean }[];
  response: ConfirmationResponse | null;
  respondedAt: Date | null;
}

/** The second-step pages, by their path under the link. */
export type StepPage = 'partly' | 'not-received' | 'other';

export const STEP_ANSWER: Record<StepPage, ConfirmationResponse> = {
  partly: 'PARTLY',
  'not-received': 'NO',
  other: 'OTHER',
};

const ANSWER_ICON: Record<ConfirmationResponse, IconName> = {
  YES: 'circle-check',
  PARTLY: 'contrast',
  NO: 'circle-x',
  OTHER: 'message-square-warning',
};

const STEP_COPY: Record<StepPage, { title: ConfirmPageKey; note: ConfirmPageKey; button: string }> = {
  partly: { title: 'partly.title', note: 'partly.note', button: 'b p' },
  'not-received': { title: 'no.title', note: 'no.note', button: 'b dp' },
  other: { title: 'other.title', note: 'other.note', button: 'b p' },
};

const STATE_KEY: Record<string, ConfirmPageKey> = {
  EMPTY: 'state.EMPTY',
  PART_FILLED: 'state.PART_FILLED',
  FULL: 'state.FULL',
};

/** The answer's own words: YES "All received", PARTLY "Partly received", NO "Not received", OTHER "Other problem". */
export function answerLabel(answer: ConfirmationResponse): string {
  return t(`answer.${answer}` as ConfirmPageKey);
}

/** A link's own lifetime (`expiresAt − deliveredAt`), as the expired page says it: "1 day", "3 days", or "36 hours" when not whole days. */
export function lifetimeWords(deliveredAt: Date, expiresAt: Date): string {
  const hours = Math.max(1, Math.round((expiresAt.getTime() - deliveredAt.getTime()) / 3_600_000));
  if (hours % 24 === 0) return hours === 24 ? t('lifetime.day') : t('lifetime.days', { n: hours / 24 });
  return hours === 1 ? t('lifetime.hour') : t('lifetime.hours', { n: hours });
}

function og(link: PageLink) {
  return { title: t('ogTitle', { shop: link.shop }), description: t('ogDescription') };
}

function orderEyebrow(link: PageLink): string {
  return eyebrow(t('eyebrow', { shop: link.shop, orderNo: link.orderNo }));
}

/** The 2-row summary: "Delivered" / "Taken back", one line per size (and state), "None" when empty. */
function summary(link: PageLink): string {
  const delivered = link.delivered.length
    ? link.delivered.map((line) => escapeHtml(t('line', { count: line.count, size: line.size }))).join('<br>')
    : escapeHtml(t('none'));
  const takenBack = link.takenBack.length
    ? link.takenBack
        .map((line) => {
          const state = STATE_KEY[line.state] ? t(STATE_KEY[line.state]) : line.state;
          const noLabel = line.unlabelled ? escapeHtml(` · ${t('noLabel')}`) : '';
          return `${escapeHtml(t('line', { count: line.count, size: line.size }))} <i class="tag">${escapeHtml(state)}</i>${noLabel}`;
        })
        .join('<br>')
    : escapeHtml(t('none'));
  return (
    '<table class="sum">' +
    `<tr><th scope="row">${escapeHtml(t('delivered'))}</th><td>${delivered}</td></tr>` +
    `<tr><th scope="row">${escapeHtml(t('takenBack'))}</th><td>${takenBack}</td></tr>` +
    '</table>'
  );
}

/** Main page (200; 400 with the "Please tap one answer below." line after an answer the page doesn't know). */
export function renderMain(link: PageLink, token: string, frame: PageFrame, opts: { chooseError?: boolean } = {}): string {
  const body =
    '<section class="c" aria-labelledby="h">' +
    eyebrow(link.shop) +
    `<h1 id="h">${escapeHtml(t('question'))}</h1>` +
    `<p class="m">${escapeHtml(t('meta', { orderNo: link.orderNo, deliveredAt: formatPkDateTime(link.deliveredAt) }))}</p>` +
    summary(link) +
    `<p class="f">${escapeHtml(t('notRight'))}</p></section>` +
    (opts.chooseError ? `<p class="err" role="alert">${escapeHtml(t('chooseError'))}</p>` : '') +
    buttonForm(token, {}, { label: answerLabel('YES'), className: 'b p', iconName: 'circle-check', name: 'answer', value: 'YES' }) +
    buttonLink(confirmationPath(token, '/partly'), answerLabel('PARTLY'), 'b', 'contrast') +
    buttonLink(confirmationPath(token, '/not-received'), answerLabel('NO'), 'b d', 'circle-x') +
    textLink(confirmationPath(token, '/other'), answerLabel('OTHER'), 'message-square-warning') +
    callRow(t('call', { shop: link.shop }), link.shopPhone) +
    `<p class="f">${escapeHtml(t('until', { expiresAt: formatPkDateTime(link.expiresAt) }))}</p>`;
  return layout({ frame, title: t('title', { shop: link.shop }), og: og(link), body, footerShop: link.shop });
}

/**
 * A second-step page (200): Partly received, Not received or Other problem, with its note box and Send.
 * The Other page refused for a missing note (400) shows the error and keeps the cleaned text.
 */
export function renderStep(
  step: StepPage,
  link: PageLink,
  token: string,
  frame: PageFrame,
  opts: { noteError?: boolean; comment?: string | null } = {},
): string {
  const copy = STEP_COPY[step];
  const answer = STEP_ANSWER[step];
  const body =
    `<form method="post" action="${escapeHtml(confirmationPath(token))}" accept-charset="utf-8">` +
    `<input type="hidden" name="v" value="1"><input type="hidden" name="answer" value="${answer}">` +
    '<section class="c" aria-labelledby="h">' +
    orderEyebrow(link) +
    `<h1 id="h">${icon(ANSWER_ICON[answer], 32)}${escapeHtml(t(copy.title))}</h1>` +
    commentField({ label: t(copy.note), value: opts.comment ?? null, error: opts.noteError ? t('noteError') : null }) +
    '</section>' +
    `<button class="${copy.button}">${escapeHtml(t('send'))}</button></form>` +
    textLink(confirmationPath(token), t('back'), 'arrow-left');
  return layout({ frame, title: t('title', { shop: link.shop }), og: og(link), body, footerShop: link.shop });
}

/** Thank you (200 after the 303): the green mark and one line for the answer given. */
export function renderThanks(link: PageLink, answer: ConfirmationResponse, frame: PageFrame): string {
  const body =
    '<section class="c" aria-labelledby="h" aria-live="polite">' +
    statusMark('ok', 'check') +
    `<h1 id="h">${escapeHtml(t('thanks.title'))}</h1>` +
    `<p class="m">${escapeHtml(t(`thanks.${answer}` as ConfirmPageKey, { shop: link.shop }))}</p></section>` +
    callRow(t('call', { shop: link.shop }), link.shopPhone);
  return layout({ frame, title: `${t('thanks.title')} · ${link.shop}`, og: og(link), body, footerShop: link.shop });
}

/** The shared layout of the state pages: the eyebrow when the link is known, the mark, h1, one line, the call row. */
function statePage(input: {
  frame: PageFrame;
  link: PageLink | null;
  mark: { kind: 'ok' | 'neutral'; icon: IconName };
  title: string;
  line: string | null;
  call: string;
  extra?: string;
}): string {
  const body =
    '<section class="c" aria-labelledby="h">' +
    (input.link ? orderEyebrow(input.link) : '') +
    statusMark(input.mark.kind, input.mark.icon) +
    `<h1 id="h">${escapeHtml(input.title)}</h1>` +
    (input.line ? `<p class="m">${escapeHtml(input.line)}</p>` : '') +
    '</section>' +
    (input.extra ?? '') +
    input.call;
  return layout({
    frame: input.frame,
    title: input.link ? `${input.title} · ${input.link.shop}` : input.title,
    og: input.link ? og(input.link) : null,
    body,
    footerShop: input.link?.shop ?? null,
  });
}

/** You already answered (200 on GET, 409 for a different answer). */
export function renderAlready(link: PageLink, frame: PageFrame): string {
  const said =
    link.response && link.respondedAt
      ? t('already.said', { answerLabel: answerLabel(link.response), respondedAt: formatPkDateTime(link.respondedAt) })
      : null;
  return statePage({
    frame,
    link,
    mark: { kind: 'ok', icon: 'check' },
    title: t('already.title'),
    line: said,
    call: callRow(t('already.call', { shop: link.shop }), link.shopPhone),
  });
}

/** This link has expired (410): the link's own lifetime, and who to call. */
export function renderExpired(link: PageLink, frame: PageFrame): string {
  return statePage({
    frame,
    link,
    mark: { kind: 'neutral', icon: 'clock' },
    title: t('expired.title'),
    line: t('expired.body', { lifetime: lifetimeWords(link.deliveredAt, link.expiresAt) }),
    call: callRow(t('expired.call', { shop: link.shop }), link.shopPhone),
  });
}

/** This link is closed (410): switched off, or a reserved CANCELLED link. */
export function renderInactive(link: PageLink, frame: PageFrame): string {
  return statePage({
    frame,
    link,
    mark: { kind: 'neutral', icon: 'link-2-off' },
    title: t('inactive.title'),
    line: t('inactive.body'),
    call: callRow(t('inactive.call', { shop: link.shop }), link.shopPhone),
  });
}

/** We can't find this link (404): no shop, order or footer; the support row only when `support.phone` is set. */
export function renderNotFound(supportPhone: string | null | undefined, frame: PageFrame): string {
  return statePage({
    frame,
    link: null,
    mark: { kind: 'neutral', icon: 'circle-help' },
    title: t('notFound.title'),
    line: t('notFound.body'),
    call: supportPhone ? callRow(t('notFound.call'), supportPhone) : '',
  });
}

/** Too many tries (429): the wait in whole minutes, rounded up. */
export function renderTooMany(minutes: number, frame: PageFrame): string {
  const wait = Math.max(1, Math.ceil(minutes));
  return statePage({
    frame,
    link: null,
    mark: { kind: 'neutral', icon: 'hourglass' },
    title: t('tooMany.title'),
    line: wait === 1 ? t('tooMany.body_one') : t('tooMany.body', { minutes: wait }),
    call: '',
  });
}

/**
 * Something went wrong (500): the answer was not saved. After a POST the [Try again] form posts the
 * same answer and note again; after a GET it opens the page again.
 */
export function renderError(
  frame: PageFrame,
  opts: { token: string | null; link: PageLink | null; form: { answer: string; comment: string | null } | null; path?: string },
): string {
  let retry = '';
  if (opts.token && opts.form) {
    const fields: Record<string, string> = { answer: opts.form.answer };
    if (opts.form.comment) fields.comment = opts.form.comment;
    retry = buttonForm(opts.token, fields, { label: t('error.retry'), className: 'b p' });
  } else if (opts.token) {
    retry = `<a class="b p" href="${escapeHtml(confirmationPath(opts.token, opts.path ?? ''))}">${escapeHtml(t('error.retry'))}</a>`;
  }
  return statePage({
    frame,
    link: opts.link,
    mark: { kind: 'neutral', icon: 'circle-alert' },
    title: t('error.title'),
    line: t('error.body'),
    call: '',
    extra: retry,
  });
}
