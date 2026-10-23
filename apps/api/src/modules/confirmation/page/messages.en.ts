/**
 * The customer page's English (`confirm.page.*`), as the simple design sets it (UX spec
 * customer-and-inc23.md §1, decided 2026-10-23; CUSTOMER_PAGE §6 for what it replaces). Every text on
 * the page comes from here through {@link t}; values are escaped by the templates, never here.
 * Urdu later is `messages.ur.ts` with the same keys.
 */
export const CONFIRM_PAGE_EN = {
  // The frame
  testStrip: 'Test only · not a real delivery',
  safety: "Smell gas? Turn off the cylinder valve, open doors and windows, don't touch switches or flames, and call 1122.",
  footer: 'Sent by Smart Fleet for {shop}.',
  // Main page (200)
  title: 'Confirm your delivery · {shop}',
  ogTitle: 'Confirm your delivery from {shop}',
  ogDescription: 'Tap to tell us what you received.',
  question: 'Did you get your delivery?',
  meta: 'Order {orderNo} · {deliveredAt}',
  delivered: 'Delivered',
  takenBack: 'Taken back',
  line: '{count} × {size}',
  'state.EMPTY': 'Empty',
  'state.PART_FILLED': 'Part-filled',
  'state.FULL': 'Full',
  noLabel: 'no label',
  none: 'None',
  notRight: 'Not right? Tap Other problem.',
  'answer.YES': 'All received',
  'answer.PARTLY': 'Partly received',
  'answer.NO': 'Not received',
  'answer.OTHER': 'Other problem',
  chooseError: 'Please tap one answer below.',
  call: 'Call {shop}',
  until: 'Answer by {expiresAt}.',
  // Second-step pages
  eyebrow: '{shop} · Order {orderNo}',
  back: 'Back',
  send: 'Send',
  'partly.title': 'Partly received',
  'partly.note': 'What was missing? (optional)',
  'no.title': 'Not received',
  'no.note': 'Anything to add? (optional)',
  'other.title': 'Other problem',
  'other.note': 'What happened?',
  noteError: 'Please write a few words.',
  // Thank you
  'thanks.title': 'Thank you!',
  'thanks.YES': 'We told {shop} you got everything.',
  'thanks.PARTLY': 'We told {shop} something was missing. They may call you.',
  'thanks.NO': 'We told {shop} you did not get it. They may call you.',
  'thanks.OTHER': 'We sent your message to {shop}. They may call you.',
  // State pages
  'already.title': 'You already answered',
  'already.said': 'You said: {answerLabel} · {respondedAt}',
  'already.call': 'Wrong? Call {shop}',
  'expired.title': 'This link has expired',
  'expired.body': 'Answers close {lifetime} after delivery.',
  'expired.call': 'Problem? Call {shop}',
  'lifetime.day': '1 day',
  'lifetime.days': '{n} days',
  'lifetime.hour': '1 hour',
  'lifetime.hours': '{n} hours',
  'inactive.title': 'This link is closed',
  'inactive.body': 'No answer is needed.',
  'inactive.call': 'Questions? Call {shop}',
  'notFound.title': "We can't find this link",
  'notFound.body': 'Open the full link in your newest message.',
  'notFound.call': 'Call Smart Fleet support',
  'tooMany.title': 'Too many tries',
  'tooMany.body': 'Please wait {minutes} minutes, then try again.',
  'tooMany.body_one': 'Please wait 1 minute, then try again.',
  'error.title': 'Something went wrong',
  'error.body': 'Your answer was not saved.',
  'error.retry': 'Try again',
} as const;

export type ConfirmPageKey = keyof typeof CONFIRM_PAGE_EN;

/** The page text for `key` with its `{param}` values filled in (unescaped: the templates escape). */
export function t(key: ConfirmPageKey, params: Record<string, string | number> = {}): string {
  return CONFIRM_PAGE_EN[key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
