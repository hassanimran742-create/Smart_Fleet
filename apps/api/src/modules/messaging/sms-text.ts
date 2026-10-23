/**
 * The SMS text of a confirmation link (CUSTOMER_PAGE §9): template `sms.deliveryConfirm.v1`, English,
 * GSM-7 basic set, one segment of at most 160 characters. The same text goes out on every app share
 * (WhatsApp, the SMS app, the share sheet, copy).
 *
 *   renderSms({ shop: 'Ali Gas', orderNo: 'AG-0142', link: 'https://smartfleetpk.com/c/…', phone: '03211234567' })
 *   // 'Ali Gas: Order AG-0142 delivered. Did you get it? Tap https://smartfleetpk.com/c/… Help: 03211234567'
 */

/** The longest SMS the pilot sends: one GSM-7 segment. */
export const SMS_MAX_LENGTH = 160;
/** The longest shop name the text carries (the page shows the full business name). */
export const SMS_SHOP_MAX = 20;
/** The name used when nothing GSM-safe is left of the shop's name (an Urdu-only name). */
export const SMS_SHOP_FALLBACK = 'Smart Fleet';

/**
 * The GSM 03.38 basic character set (no escape and no extension table: `{ } [ ] ~ \ | ^ €` cost two
 * characters each and are not allowed).
 */
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);

/** True when every character of `text` is in the GSM-7 basic set. */
export function isGsm7Basic(text: string): boolean {
  for (const ch of text) if (!GSM7_BASIC.has(ch)) return false;
  return true;
}

/**
 * A business name made SMS-safe (CUSTOMER_PAGE §9 `smsShopName`): accents decomposed and their marks
 * dropped; ’ ‘ → ', – — → -, … → ..., other spaces → space; “ ” removed; only A–Z, a–z, 0–9, space and
 * `. , - & ' ( ) ! ? /` kept; spaces collapsed, trimmed, cut to 20, trimmed. Nothing left (an
 * Urdu-only name) gives "Smart Fleet".
 */
export function smsShopName(name: string): string {
  const cleaned = (typeof name === 'string' ? name : '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u201c\u201d]/g, '')
    .replace(/[^A-Za-z0-9 .,\-&'()!?/]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  const cut = cleaned.slice(0, SMS_SHOP_MAX).trim();
  return cut === '' ? SMS_SHOP_FALLBACK : cut;
}

export interface SmsParts {
  /** The business name as stored; it is made GSM-safe here. */
  shop: string;
  /** The order's short code, for example "AG-0142". */
  orderNo: string;
  /** The full link, `https://<link host>/c/<token>`. */
  link: string;
  /** The shop's phone in compact form ("03211234567"), or '' when it has none. */
  phone: string;
}

export interface RenderedSms {
  text: string;
  /** The template parameters as sent (`shop` is the GSM-safe, possibly shortened name). */
  params: { shop: string; orderNo: string; link: string; phone: string };
  /** True when " Help: {phone}" was dropped to fit. */
  helpDropped: boolean;
}

function compose(shop: string, orderNo: string, link: string, phone: string | null): string {
  const help = phone ? ` Help: ${phone}` : '';
  return `${shop}: Order ${orderNo} delivered. Did you get it? Tap ${link}${help}`;
}

/**
 * Renders `sms.deliveryConfirm.v1`. When it is too long it drops " Help: {phone}" first, then shortens
 * the shop name; the link always stays whole and nothing follows it except " Help: …" or the end of the
 * text. Throws when the result is still over 160 characters or leaves the GSM-7 basic set (a link host
 * far longer than the pilot's).
 */
export function renderSms(parts: SmsParts): RenderedSms {
  const phone = parts.phone.trim();
  let shop = smsShopName(parts.shop);
  let helpDropped = false;
  let text = compose(shop, parts.orderNo, parts.link, phone || null);
  if (text.length > SMS_MAX_LENGTH && phone) {
    helpDropped = true;
    text = compose(shop, parts.orderNo, parts.link, null);
  }
  if (text.length > SMS_MAX_LENGTH) {
    const over = text.length - SMS_MAX_LENGTH;
    const shorter = shop.slice(0, Math.max(0, shop.length - over)).trim();
    shop = shorter === '' ? shop.slice(0, 1) : shorter;
    text = compose(shop, parts.orderNo, parts.link, null);
  }
  if (text.length > SMS_MAX_LENGTH) throw new Error(`the confirmation SMS is ${text.length} characters (at most ${SMS_MAX_LENGTH})`);
  if (!isGsm7Basic(text)) throw new Error('the confirmation SMS leaves the GSM-7 basic set');
  return { text, params: { shop, orderNo: parts.orderNo, link: parts.link, phone: helpDropped ? '' : phone }, helpDropped };
}

/**
 * The text as the message log keeps it (`outbound_messages.body_redacted`): the link token replaced by
 * `[link]`, so no live link is ever stored (CUSTOMER_PAGE §8, §12).
 */
export function redactLinkToken(text: string, token: string): string {
  return token ? text.split(token).join('[link]') : text;
}
