import type { ConfirmationResponse, ConfirmationShareVia, ConfirmationView, OrderDto } from '@smartfleet/shared-types';
import { MESSAGE_FAIL_CODES, type MessageFailCode } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import type { AnswerChipState } from '../../../ui/statusTables';

/**
 * [Inc 2] The customer answer chip beside a delivered order's stage chip (UX_MOBILE S15), while
 * confirmations are on: the answer once given, "Waiting for customer" while the link is open, "No
 * answer" once it closed. Null when the order has no confirmation.
 */
export function answerChipOf(order: Pick<OrderDto, 'confirmation'>): AnswerChipState | null {
  const summary = order.confirmation;
  if (!summary) return null;
  if (summary.status === 'ANSWERED') return summary.response ?? null;
  if (summary.status === 'PENDING') return 'PENDING';
  if (summary.status === 'EXPIRED') return 'EXPIRED';
  return null;
}

/**
 * [Inc 2] What the customer answer card shows in each state (CUSTOMER_PAGE §10; Inc 2/3 spec §2.5):
 * the chip, the one line, the footer's main button and the card's ghost. Plain logic over the
 * `ConfirmationView`; it imports only the shared packages, so the API's unit tests can load it.
 */

export type CardChip =
  | { kind: 'answer'; value: ConfirmationResponse | 'PENDING' | 'EXPIRED'; at: string | null }
  /** The reserved CANCELLED state: a grey "Not needed". */
  | { kind: 'notNeeded' };

export type CardLine =
  | { kind: 'notSent'; name: string; phone: string }
  | { kind: 'smsFailed'; reason: MessageFailCode }
  | { kind: 'smsSending' }
  | { kind: 'smsSent'; at: string; phone: string }
  | { kind: 'shared'; at: string; via: ConfirmationShareVia }
  | { kind: 'badPhone'; phone: string }
  | { kind: 'numberChanged' }
  /** ANSWERED: the customer's note in quotes, then "The office will look into it." while a problem is open. */
  | { kind: 'answered'; comment: string | null; officeWillCheck: boolean };

/** The screen footer's one main button. */
export type CardMain = 'whatsapp' | 'fixNumber' | 'makeNewLink';
/** The ghost in the card: both open the Send link sheet. */
export type CardGhost = 'otherWays' | 'sendAgain';

export interface CardModel {
  chip: CardChip;
  line: CardLine | null;
  /** "Link open until …" while the link is open. */
  until: string | null;
  main: CardMain | null;
  ghost: CardGhost | null;
  /** The sheet offers WhatsApp and Text message only for a mobile number. */
  sendsDirect: boolean;
  /** The sheet's "Make a new link" (the server's NEW_LINK). */
  newLink: boolean;
}

export interface CardOptions {
  /** The customer's number now (`order.client.phone`); a fixed number differs from the link's. */
  currentPhone: string | null;
  /** Set right after Edit customer answered `confirmationNeedsNewLink`, before the order has refreshed. */
  numberFixed?: boolean;
}

function failReason(code: string | null | undefined): MessageFailCode {
  return (MESSAGE_FAIL_CODES as readonly string[]).includes(code ?? '') ? (code as MessageFailCode) : 'UNKNOWN';
}

/**
 * True when the link was made for another number than the customer has now: a number fixed with Edit
 * customer takes effect only with a new link (API_CONTRACT §9.12). A link with no mobile number and a
 * mobile number stored now counts too.
 */
export function numberChangedSinceLink(view: ConfirmationView, currentPhone: string | null): boolean {
  const now = normalizePkPhone(currentPhone);
  if (now === null) return false;
  const link = view.customer.phoneValid ? normalizePkPhone(view.customer.phoneDisplay) : null;
  return link === null || link !== now;
}

const NOTHING = { line: null, until: null, main: null, ghost: null, sendsDirect: false, newLink: false } as const;

export function cardModel(view: ConfirmationView, options: CardOptions): CardModel {
  if (view.status === 'CANCELLED') return { ...NOTHING, chip: { kind: 'notNeeded' } };
  if (view.status === 'EXPIRED') return { ...NOTHING, chip: { kind: 'answer', value: 'EXPIRED', at: null } };
  if (view.status === 'ANSWERED') {
    return {
      ...NOTHING,
      chip: { kind: 'answer', value: view.response ?? 'OTHER', at: view.respondedAt },
      line: { kind: 'answered', comment: view.comment?.trim() ? view.comment.trim() : null, officeWillCheck: view.caseOpen },
    };
  }

  // PENDING.
  const share = view.allowedActions.includes('SHARE');
  const newLink = view.allowedActions.includes('NEW_LINK');
  const chip: CardChip = { kind: 'answer', value: 'PENDING', at: null };
  const base = { chip, until: view.expiresAt, newLink, sendsDirect: share && view.customer.phoneValid };

  if (newLink && (options.numberFixed || numberChangedSinceLink(view, options.currentPhone))) {
    return { ...base, line: { kind: 'numberChanged' }, main: 'makeNewLink', ghost: null, sendsDirect: false };
  }
  if (!view.customer.phoneValid) {
    return {
      ...base,
      line: { kind: 'badPhone', phone: view.customer.phoneDisplay },
      main: 'fixNumber',
      ghost: share ? 'otherWays' : null,
    };
  }

  const last = view.lastMessage;
  switch (view.reach) {
    case 'SMS_FAILED':
      return {
        ...base,
        line: { kind: 'smsFailed', reason: failReason(last?.errorCode) },
        main: share ? 'whatsapp' : null,
        ghost: share ? 'otherWays' : null,
      };
    case 'SMS_SENDING':
      return { ...base, line: { kind: 'smsSending' }, main: null, ghost: share ? 'sendAgain' : null };
    case 'SMS_SENT':
      return {
        ...base,
        line: last ? { kind: 'smsSent', at: last.at, phone: view.customer.phoneDisplay } : { kind: 'smsSending' },
        main: null,
        ghost: share ? 'sendAgain' : null,
      };
    case 'SHARED':
      return {
        ...base,
        line: last?.via ? { kind: 'shared', at: last.at, via: last.via } : null,
        main: null,
        ghost: share ? 'sendAgain' : null,
      };
    case 'NOT_SENT':
    default:
      return {
        ...base,
        line: { kind: 'notSent', name: view.customer.name, phone: view.customer.phoneDisplay },
        main: share ? 'whatsapp' : null,
        ghost: share ? 'otherWays' : null,
      };
  }
}
