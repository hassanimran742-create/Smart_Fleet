/**
 * The customer page's building blocks (CUSTOMER_PAGE §6; UX spec customer-and-inc23.md §1.0): pure
 * functions that return HTML. Every value goes through {@link escapeHtml}; every text comes from
 * `t()` (messages.en.ts). No JavaScript, cookies, fonts or image files; the favicon is `data:,`.
 */
import type { AppEnvironment } from '@smartfleet/shared-types';
import { formatPkPhone, normalizePkPhone } from '@smartfleet/shared-utils';
import { confirmationPath, telHref } from '../confirmation-links';
import { icon, type IconName } from './icons';
import { t } from './messages.en';
import { PAGE_CSS } from './tokens';

/** Escapes text for HTML content and double- or single-quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** What every page needs to know about the deployment. */
export interface PageFrame {
  /** APP_ENV: anything but `production` shows the test strip. */
  environment: AppEnvironment;
}

export interface LayoutInput {
  frame: PageFrame;
  title: string;
  /** The link preview's title and description; only pages of a known link have them. */
  og?: { title: string; description: string } | null;
  body: string;
  /** The shop's name for the footer line; pages that don't know the shop leave it out. */
  footerShop?: string | null;
}

/**
 * The page frame: the head (no robots, no referrer, the link preview, the `data:,` favicon and the
 * literal CSS), the test strip on test servers, the body, then always the gas safety note as the last
 * block before the footer line.
 */
export function layout(input: LayoutInput): string {
  const og = input.og
    ? `<meta property="og:title" content="${escapeHtml(input.og.title)}"><meta property="og:description" content="${escapeHtml(input.og.description)}">`
    : '';
  return (
    '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">' +
    '<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">' +
    og +
    `<link rel="icon" href="data:,"><title>${escapeHtml(input.title)}</title><style>${PAGE_CSS}</style></head>` +
    '<body><main class="w">' +
    testBanner(input.frame) +
    input.body +
    safetyNote() +
    (input.footerShop ? `<p class="f">${escapeHtml(t('footer', { shop: input.footerShop }))}</p>` : '') +
    '</main></body></html>'
  );
}

/** The yellow strip on any APP_ENV other than production. */
export function testBanner(frame: PageFrame): string {
  return frame.environment === 'production' ? '' : `<p class="strip">${escapeHtml(t('testStrip'))}</p>`;
}

/** The gas safety note: never cut, on every page. */
export function safetyNote(): string {
  return `<p class="safe" role="note">${escapeHtml(t('safety'))}</p>`;
}

/** The small grey line above a heading. */
export function eyebrow(text: string): string {
  return `<p class="s">${escapeHtml(text)}</p>`;
}

/** The 64 px circle on result and state pages: green (`ok`) or neutral grey. */
export function statusMark(kind: 'ok' | 'neutral', name: IconName): string {
  return `<div class="mk${kind === 'ok' ? ' ok' : ''}">${icon(name, 36)}</div>`;
}

/** How a phone is shown on the page: "0321 1234567" for a Pakistani mobile, else as stored. */
export function phoneDisplay(phone: string): string {
  return normalizePkPhone(phone) ? formatPkPhone(phone, 'local') : phone.trim();
}

/**
 * A full-width 48 px tap-to-call row with the phone icon: "{label} · {phone}". The phone shows in
 * local style; the href is E.164 (else the stored digits). Nothing when there is no number.
 */
export function callRow(label: string, phone: string | null | undefined): string {
  const href = telHref(phone);
  if (!href || !phone) return '';
  return `<a class="call" href="${escapeHtml(href)}">${icon('phone')}${escapeHtml(`${label} · ${phoneDisplay(phone)}`)}</a>`;
}

/** A form POST to the link with one answer button (the main page's All received, the 500 page's Try again). */
export function buttonForm(
  token: string,
  fields: Record<string, string>,
  button: { label: string; className: string; iconName?: IconName; name?: string; value?: string },
): string {
  const hidden = Object.entries({ v: '1', ...fields })
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
  const nameValue = button.name ? ` name="${escapeHtml(button.name)}" value="${escapeHtml(button.value ?? '')}"` : '';
  return (
    `<form method="post" action="${escapeHtml(confirmationPath(token))}" accept-charset="utf-8">${hidden}` +
    `<button class="${button.className}"${nameValue}>${button.iconName ? icon(button.iconName) : ''}${escapeHtml(button.label)}</button></form>`
  );
}

/** A link styled as a button (Partly received, Not received). */
export function buttonLink(href: string, label: string, className: string, iconName: IconName): string {
  return `<a class="${className}" href="${escapeHtml(href)}">${icon(iconName)}${escapeHtml(label)}</a>`;
}

/** A full-width 48 px text link (Other problem, Back). */
export function textLink(href: string, label: string, iconName: IconName): string {
  return `<a class="blk" href="${escapeHtml(href)}">${icon(iconName)}${escapeHtml(label)}</a>`;
}

/**
 * The note box of a second-step page: its label, the error (only after a refusal, announced and
 * pointed at by the box) and the textarea, stopped at the server's own 300-character cut.
 */
export function commentField(input: { label: string; value: string | null; error: string | null }): string {
  const error = input.error ? `<p class="err" id="e" role="alert">${escapeHtml(input.error)}</p>` : '';
  const invalid = input.error ? ' aria-invalid="true" aria-describedby="e" autofocus' : '';
  return (
    `<label for="n">${escapeHtml(input.label)}</label>${error}` +
    `<textarea id="n" name="comment" maxlength="300"${invalid}>${escapeHtml(input.value ?? '')}</textarea>`
  );
}
