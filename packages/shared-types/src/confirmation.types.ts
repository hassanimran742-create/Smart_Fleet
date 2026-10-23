/**
 * Customer confirmation (Inc 2, ADR-15) is a record only and never moves money. Inc 1 needs only the
 * answer codes, for setting `confirmation.caseOnAnswers`; the rest of this file is the Inc 2 contract
 * (API_CONTRACT §9.6-§9.7, CUSTOMER_PAGE §10), typed ahead so the apps and the API share it.
 */

/** Mirrors Prisma `ConfirmationResponse` (inc2): All received, Partly received, Not received, Other problem. */
export const ConfirmationResponse = {
  YES: 'YES',
  PARTLY: 'PARTLY',
  NO: 'NO',
  OTHER: 'OTHER',
} as const;
export type ConfirmationResponse = (typeof ConfirmationResponse)[keyof typeof ConfirmationResponse];

/** [Inc 2] Mirrors Prisma `ConfirmationStatus`. CANCELLED is reserved: no pilot route writes it (G07-04). */
export type ConfirmationStatus = 'PENDING' | 'ANSWERED' | 'EXPIRED' | 'CANCELLED';

/**
 * [Inc 2] How far the current link got, from the newest message row of the current link version
 * (CUSTOMER_PAGE §10): none, SKIPPED or QUEUED for 2 minutes or more → NOT_SENT; QUEUED for less →
 * SMS_SENDING; SENT or DELIVERED → SMS_SENT; FAILED → SMS_FAILED; a share row → SHARED.
 */
export const CONFIRMATION_REACHES = ['NOT_SENT', 'SMS_SENDING', 'SMS_SENT', 'SMS_FAILED', 'SHARED'] as const;
export type ConfirmationReach = (typeof CONFIRMATION_REACHES)[number];

/** [Inc 2] How the shop or the office passed the link on (`POST /orders/:id/confirmation/share`). */
export const CONFIRMATION_SHARE_VIAS = ['WHATSAPP', 'SMS', 'SHARE_SHEET', 'COPY'] as const;
export type ConfirmationShareVia = (typeof CONFIRMATION_SHARE_VIAS)[number];

/** [Inc 2] `GET /orders/:id/confirmation`, and the answer of `new-link` (CUSTOMER_PAGE §10). */
export interface ConfirmationView {
  orderId: string;
  orderShortCode: string;
  status: ConfirmationStatus;
  response: ConfirmationResponse | null;
  comment: string | null;
  respondedAt: string | null;
  expiresAt: string;
  reach: ConfirmationReach;
  /** The newest row of the current link version; null right after a new link. */
  lastMessage: {
    channel: string;
    status: string;
    errorCode: string | null;
    at: string;
    byName: string | null;
    via: ConfirmationShareVia | null;
  } | null;
  customer: { name: string; phoneDisplay: string; phoneValid: boolean };
  delivered: { size: string; count: number }[];
  takenBack: { size: string; state: string; count: number; unlabelled: boolean }[];
  caseOpen: boolean;
  allowedActions: ('SHARE' | 'NEW_LINK')[];
}

/** [Inc 2] `POST /orders/:id/confirmation/share`. The URLs are null when the customer's phone is invalid. */
export interface ConfirmationShareResult {
  url: string;
  message: string;
  whatsappUrl: string | null;
  smsUrl: string | null;
  expiresAt: string;
}

/** [Inc 2] The confirmation summary on order lists (`GET /orders?tab`, `GET /orders/board`). */
export interface OrderConfirmationSummary {
  status: ConfirmationStatus;
  response: ConfirmationResponse | null;
  caseOpen: boolean;
}

/** [Inc 2] A customer problem case is OPEN until the office resolves it with a note (API_CONTRACT §9.6). */
export type CaseStatus = 'OPEN' | 'RESOLVED';

/**
 * [Inc 2] A customer problem (`GET /alerts?type=CUSTOMER_PROBLEM`, `GET /alerts/mine`,
 * `POST /alerts/:id/resolve`; API_CONTRACT §9.6). `allowedActions` is `[]` for the shop.
 */
export interface CaseDto {
  id: string;
  status: CaseStatus;
  order: { id: string; shortCode: string };
  answer: ConfirmationResponse;
  comment: string | null;
  customerName: string;
  distributor: { id: string; businessName: string };
  openedAt: string;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  resolutionNote: string | null;
  allowedActions: 'RESOLVE'[];
}
