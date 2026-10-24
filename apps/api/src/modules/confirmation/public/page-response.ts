/**
 * How every `/c/` response goes out (CUSTOMER_PAGE §4): HTML with the page headers, whatever the
 * status, a redirect included. Never JSON, never a cookie, never the requested URL.
 */
import type { Response } from 'express';

/** The headers on every response of the public link page. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function setPageHeaders(res: Response, extra: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...PAGE_HEADERS, ...extra })) res.setHeader(name, value);
}

/** Sends a whole page with its status: `res.status(code).type('html').send(html)`. */
export function sendPage(res: Response, status: number, html: string, extra: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  setPageHeaders(res, extra);
  res.status(status).type('html').send(html);
}

/** The post/redirect/get answer: 303 to `location` (a relative `/c/<token>?done=1`), with the page headers. */
export function sendRedirect(res: Response, location: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  setPageHeaders(res, { Location: location });
  res.status(303).type('html').send('');
}
