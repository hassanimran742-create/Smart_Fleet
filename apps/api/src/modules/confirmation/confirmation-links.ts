/**
 * The link and phone forms a confirmation uses (CUSTOMER_PAGE §6, §8-§10; API_CONTRACT §1.1). A
 * stored number is E.164 (`+923001234567`); each use writes it its own way:
 *
 * | Use | Form | Helper |
 * |---|---|---|
 * | the page, the apps | 0300 1234567 | `formatPkPhone(e164, 'local')` (shared-utils) |
 * | the SMS help part | 03001234567 | `formatPkPhone(e164, 'compact')` |
 * | wa.me | 923001234567 | {@link waMeNumber} |
 * | sms: | +923001234567 | {@link smsUrl} |
 * | tel: | +923001234567 | {@link telHref} |
 * | logs | +923*****67 | `maskPhone(e164)` (shared-utils) |
 */
import { normalizePkPhone } from '@smartfleet/shared-utils';

/**
 * Where links point (env `PUBLIC_LINK_BASE_URL`, https in staging and production), without a trailing
 * slash. Without it (development, tests that set nothing) the API's own local address is used.
 */
export function publicLinkBase(env: Record<string, string | undefined> = process.env): string {
  const base = (env.PUBLIC_LINK_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (base) return base;
  const port = Number(env.API_PORT ?? env.PORT ?? 3000);
  return `http://localhost:${Number.isFinite(port) ? port : 3000}`;
}

/** The public page of a token: `<link base>/c/<token>`. */
export function confirmationUrl(token: string, env: Record<string, string | undefined> = process.env): string {
  return `${publicLinkBase(env)}/c/${token}`;
}

/** The relative path of a token's page, as the page's own links and forms use it. */
export function confirmationPath(token: string, step = ''): string {
  return `/c/${token}${step}`;
}

/** The number wa.me takes: E.164 without the plus ("923001234567"). */
export function waMeNumber(e164: string): string {
  return e164.replace(/^\+/, '');
}

/** `https://wa.me/923001234567?text=<the message>` for the shop's "Send on WhatsApp". */
export function whatsappUrl(e164: string, text: string): string {
  return `https://wa.me/${waMeNumber(e164)}?text=${encodeURIComponent(text)}`;
}

/** `sms:+923001234567?body=<the message>` for the shop's "Send by text message". */
export function smsUrl(e164: string, text: string): string {
  return `sms:${e164}?body=${encodeURIComponent(text)}`;
}

/**
 * The `tel:` target of a phone: the E.164 value for a Pakistani mobile, else the stored digits keeping
 * a leading + (CUSTOMER_PAGE §6). Null when there are no digits at all.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (typeof phone !== 'string') return null;
  const e164 = normalizePkPhone(phone);
  if (e164) return `tel:${e164}`;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
