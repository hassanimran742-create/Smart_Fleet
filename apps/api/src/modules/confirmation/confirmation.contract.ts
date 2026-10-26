/**
 * Customer confirmation [Inc 2] (docs/pilot/CUSTOMER_PAGE.md, API_CONTRACT §5.9 and §9.7, ADR-15): the
 * service every lane codes against. It is a record only and **never calls the wallet**.
 *
 * This file is the contract (it imports no implementation, so the service can extend it without an
 * import cycle); confirmation.interface.ts re-exports it and registers the real service. While
 * `confirmation.enabled` is false (the default), issuing does nothing, so a stop finish or a manual
 * delivery works the same with or without this slice.
 *
 * How a delivering write uses it (the DELIVERY stop finish, the legacy driver `PATCH /orders/:id/status
 * DELIVERED`, and the office manual delivery v2):
 *
 *   const issued = await this.prisma.$transaction(async (tx) => {
 *     // ... lock the order, guarded update to DELIVERED, the stop to DONE ...
 *     return this.confirmations.issueForDeliveredOrder(tx, { orderId, stopId, deliveredAt });
 *   });
 *   void this.confirmations.sendIssued(issued); // after commit; never throws
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ConfirmationResponse,
  ConfirmationShareResult,
  ConfirmationShareVia,
  ConfirmationView,
  OrderConfirmationSummary,
} from '@smartfleet/shared-types';
import type { UserActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import type { IdempotentResponse } from '../../common/idempotency/idempotency';

/** The caller's transaction, or the client outside one. */
export type ConfirmationDb = Prisma.TransactionClient;

/** What a delivering write passes, inside its own transaction. */
export interface IssueConfirmationInput {
  /** The order the same transaction just set DELIVERED. */
  orderId: string;
  /**
   * The order's DELIVERY stop: its GIVEN and TAKEN_BACK rows and its unlabelled counts are frozen into
   * the snapshot (CUSTOMER_PAGE §3). The office manual delivery v2 writes those rows on the same stop.
   */
  stopId: string;
  /** `orders.delivered_at` as the same transaction wrote it: `expiresAt = deliveredAt + confirmation.linkTtlHours`. */
  deliveredAt: Date;
}

/** The result of issuing, for {@link ConfirmationService.sendIssued} after commit. */
export interface IssuedConfirmation {
  confirmationId: string;
  orderId: string;
  /**
   * The QUEUED SMS row (`confirm:<orderId>:v1:sms`) to send after commit. Null when the customer's
   * phone isn't a valid mobile (`phone_e164` NULL, no SMS row: the shop card asks for a fix) or when
   * the row already existed.
   */
  messageId: string | null;
  /** False when a confirmation already existed for the order: issuing is idempotent and returns it unchanged. */
  created: boolean;
}

/** `POST /c/:token` when it doesn't throw: both answers redirect 303 to `/c/:token?done=1` (CUSTOMER_PAGE §4). */
export interface RecordAnswerResult {
  answer: ConfirmationResponse;
  /** True when this request recorded the answer; false when the same answer was already stored (nothing recorded). */
  recorded: boolean;
}

/**
 * Inject it by this class. Every method follows API_CONTRACT §9.7 and CUSTOMER_PAGE §1-§10; the common
 * checks of the three office/shop routes run first in each: the setting switch (403 FEATURE_DISABLED),
 * a driver or another distributor 404, not DELIVERED 409 CONFIRM_NOT_READY, no row 404 NOT_FOUND.
 */
export abstract class ConfirmationService {
  /**
   * Runs inside the transaction of every write that sets an order DELIVERED from Inc 2. Does nothing
   * (null) while `confirmation.enabled` is false; switching it on never back-fills. Otherwise writes the
   * `delivery_confirmations` row (PENDING, the snapshot, `tokenVersion` 1) and, when the customer's phone
   * is a valid mobile, a QUEUED SMS row in `outbound_messages`. Idempotent: an existing row is returned
   * unchanged (`created: false`). No money.
   */
  abstract issueForDeliveredOrder(tx: ConfirmationDb, input: IssueConfirmationInput): Promise<IssuedConfirmation | null>;

  /** After the issuing transaction commits: sends its queued SMS, if any. Never throws; null does nothing. */
  abstract sendIssued(issued: IssuedConfirmation | null): Promise<void>;

  /** `GET /orders/:id/confirmation` (owning distributor, office). */
  abstract view(orderId: string, actor: UserActor): Promise<ConfirmationView>;

  /**
   * `POST /orders/:id/confirmation/share` (owning distributor, office; Idempotency-Key). Re-derives the
   * current link (no rotation) and writes one share row `share:<orderId>:<key or a new uuid>`. A repeat
   * with the key is a replay (200 `Idempotent-Replay`, nothing written; 409 IDEMPOTENCY_CONFLICT when
   * `via` differs); then 409 CONFIRM_CLOSED; then 20 shares per order per hour (429 RATE_LIMITED `{minutes}`).
   */
  abstract share(
    orderId: string,
    via: ConfirmationShareVia,
    idempotencyKey: string | undefined,
    actor: UserActor,
  ): Promise<ConfirmationShareResult | IdempotentResponse<ConfirmationShareResult>>;

  /**
   * `POST /orders/:id/confirmation/new-link` (owning distributor, office; Idempotency-Key): the key of the
   * last rotation is a replay; not PENDING or expired 409 CONFIRM_CLOSED; `send: 'SMS'` with an invalid
   * phone 400 CLIENT_PHONE_INVALID; then `tokenVersion + 1`, a new hash, the phone refreshed, audit
   * `confirmation.new_link`, and with `send: 'SMS'` a QUEUED row sent after commit. `expiresAt` never changes.
   */
  abstract newLink(
    orderId: string,
    p: { send?: 'SMS'; idempotencyKey?: string },
    actor: UserActor,
  ): Promise<ConfirmationView | IdempotentResponse<ConfirmationView>>;

  /**
   * `POST /c/:token` (public). One transaction: lock the row by `sha256(token)`, re-check PENDING and
   * the expiry, record the answer, audit `confirmation.answer` (actor CUSTOMER `link:<orderShortCode>`,
   * no IP or user agent), and raise one CUSTOMER_PROBLEM case when the answer is in
   * `confirmation.caseOnAnswers` (`alerts.raise(..., tx)`: if it fails, the answer rolls back). Throws
   * CONFIRM_LINK_INVALID, CONFIRM_LINK_INACTIVE, CONFIRM_LINK_EXPIRED, CONFIRM_ALREADY_ANSWERED (another
   * answer), CONFIRM_NOTE_REQUIRED or VALIDATION_FAILED, which the public page renders as HTML.
   */
  abstract record(token: string, answer: ConfirmationResponse, comment: string | null): Promise<RecordAnswerResult>;

  /** The confirmation-expiry job (every 15 minutes, on or off): PENDING past `expires_at` → EXPIRED. Returns how many. */
  abstract expireDue(now?: Date): Promise<number>;

  /** Order lists (`GET /orders?tab`, `GET /orders/board`): `confirmation` per order in one query; an order with none is absent. */
  abstract summariesFor(orderIds: readonly string[], db?: ConfirmationDb): Promise<Map<string, OrderConfirmationSummary>>;

  /** `PATCH /clients/:id`: true when the customer has a PENDING confirmation, so the answer adds `confirmationNeedsNewLink`. */
  abstract hasPendingForClient(clientId: string, db?: ConfirmationDb): Promise<boolean>;
}

/**
 * The no-op stand-in the database lane shipped before this lane: issuing does nothing (as with
 * `confirmation.enabled` off), the summaries are empty and no customer has a pending link; the route
 * methods answer INTERNAL_ERROR `{ reason: 'NOT_IMPLEMENTED' }`. The module no longer registers it (it
 * provides `ConfirmationServiceImpl`); it stays for unit tests that need a silent ConfirmationService.
 */
@Injectable()
export class NoopConfirmationService extends ConfirmationService {
  async issueForDeliveredOrder(_tx: ConfirmationDb, _input: IssueConfirmationInput): Promise<IssuedConfirmation | null> {
    return null;
  }

  async sendIssued(_issued: IssuedConfirmation | null): Promise<void> {
    return undefined;
  }

  async view(_orderId: string, _actor: UserActor): Promise<ConfirmationView> {
    throw new AppError('INTERNAL_ERROR', { reason: 'NOT_IMPLEMENTED' });
  }

  async share(_orderId: string, _via: ConfirmationShareVia, _idempotencyKey: string | undefined, _actor: UserActor): Promise<ConfirmationShareResult> {
    throw new AppError('INTERNAL_ERROR', { reason: 'NOT_IMPLEMENTED' });
  }

  async newLink(_orderId: string, _p: { send?: 'SMS'; idempotencyKey?: string }, _actor: UserActor): Promise<ConfirmationView> {
    throw new AppError('INTERNAL_ERROR', { reason: 'NOT_IMPLEMENTED' });
  }

  async record(_token: string, _answer: ConfirmationResponse, _comment: string | null): Promise<RecordAnswerResult> {
    throw new AppError('INTERNAL_ERROR', { reason: 'NOT_IMPLEMENTED' });
  }

  async expireDue(_now?: Date): Promise<number> {
    return 0;
  }

  async summariesFor(_orderIds: readonly string[], _db?: ConfirmationDb): Promise<Map<string, OrderConfirmationSummary>> {
    return new Map();
  }

  async hasPendingForClient(_clientId: string, _db?: ConfirmationDb): Promise<boolean> {
    return false;
  }
}
