/**
 * Messaging [Inc 2] (docs/pilot/CUSTOMER_PAGE.md §8, API_CONTRACT §5.9, ADR-20): the provider
 * interface every SMS or WhatsApp sender implements, and the `MessagingService` the confirmation lane
 * builds on it. This file is the cross-lane contract plus no-op stubs; the confirmation lane replaces
 * `NoopMessagingService` with the real service (test mode, the outbound_messages log, sends after
 * commit) and keeps these names.
 *
 * Rules every implementation keeps:
 * - The provider is picked by env `MESSAGING_PROVIDER` (`mock` for the pilot); an unknown name refuses
 *   to boot. Nothing outside this module knows which provider is live.
 * - Test mode (`messaging.testMode`, default on) is checked before the provider: only numbers on
 *   `messaging.allowlist` are sent; everyone else is SKIPPED with `NOT_A_TEST_PHONE`.
 * - A provider is never called inside a transaction: the QUEUED row is written in the transaction that
 *   delivered the order (or made a new link), and the send runs after commit (API_CONTRACT §4.5).
 * - The link token never reaches a log or the database: rows keep `bodyRedacted` (`[link]`), and the
 *   mock logs only the masked number, the template and the length.
 * - No money, ever.
 */
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { MessageChannel, MessageFailCode, MessageSkipReason, MessageStatus } from '@smartfleet/shared-types';
import { maskPhone } from '@smartfleet/shared-utils';
import { AppError } from '../../common/errors/app-error';

/** The channels a provider sends on. `SHARE_LINK` rows are written by the apps' shares, never sent. */
export type ProviderChannel = Exclude<MessageChannel, 'SHARE_LINK'>;

/** The one template of the pilot (CUSTOMER_PAGE §9): `{shop}: Order {orderNo} delivered. Did you get it? Tap {link} Help: {phone}`. */
export const DELIVERY_CONFIRM_TEMPLATE = 'sms.deliveryConfirm.v1';
export type MessageTemplateKey = typeof DELIVERY_CONFIRM_TEMPLATE;

/** One message for a provider (CUSTOMER_PAGE §8). */
export interface OutboundRequest {
  /** `outbound_messages.id`: the provider's idempotency key. */
  messageId: string;
  channel: ProviderChannel;
  /** E.164, for example +923001234567. */
  toE164: string;
  templateKey: MessageTemplateKey;
  locale: 'en';
  /** shop, orderNo, link, phone. */
  params: Record<string, string>;
  /** Rendered and GSM-7 checked; WhatsApp adapters use `templateKey` and `params` instead. */
  text: string;
}

/** What a provider (or test mode in front of it) answers. */
export type SendResult =
  | { kind: 'SENT'; providerMessageId: string }
  | { kind: 'SKIPPED'; reason: MessageSkipReason }
  | { kind: 'FAILED'; code: MessageFailCode; detail?: string };

/** An SMS or WhatsApp sender: mock now, an SMS company next, WhatsApp after Meta agrees (ADR-20). */
export interface MessagingProvider {
  /** mock | eocean | (later) whatsapp-cloud. Stored as `outbound_messages.provider`. */
  readonly name: string;
  supports(channel: ProviderChannel): boolean;
  send(req: OutboundRequest): Promise<SendResult>;
}

/** The DI token of the live {@link MessagingProvider}, chosen from env `MESSAGING_PROVIDER`. */
export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

/** The provider names this build knows. */
export const MESSAGING_PROVIDER_NAMES = ['mock'] as const;

/**
 * One `outbound_messages` row (DATA_MODEL §4.3). An SMS is written QUEUED in the delivering
 * transaction and sent after commit; an app share is written SENT with the provider `share-whatsapp`,
 * `share-sms`, `share-sheet` or `share-copy` and the user who shared.
 */
export interface OutboundMessageRecord {
  channel: MessageChannel;
  /** mock | eocean | share-whatsapp | share-sms | share-sheet | share-copy */
  provider: string;
  toPhoneE164: string | null;
  templateKey: MessageTemplateKey;
  locale?: 'en';
  /** The text with the link token replaced by `[link]`; at most 320 characters. */
  bodyRedacted: string;
  /** QUEUED for an SMS still to send; SENT for a share. */
  status: Extract<MessageStatus, 'QUEUED' | 'SENT'>;
  /** `confirm:<orderId>:v<n>:sms` | `share:<orderId>:<Idempotency-Key, or a new uuid>`. */
  idempotencyKey: string;
  confirmationId: string | null;
  /** The link version the message carried. */
  tokenVersion: number | null;
  orderId: string | null;
  distributorId: string | null;
  createdByUserId: string | null;
}

/**
 * The message log and the sends (API_CONTRACT §5.9: `MessagingProvider.send(m)` returns SENT, SKIPPED
 * or FAILED; `MessagingService.record(...)` writes `outbound_messages`). Inject it by this class.
 */
export abstract class MessagingService {
  /**
   * Writes one `outbound_messages` row in the caller's transaction. A row with the same
   * `idempotencyKey` (`outbound_messages_idempotency_key_key`) is returned as it is, with
   * `replayed: true`, and nothing is written.
   */
  abstract record(tx: Prisma.TransactionClient, row: OutboundMessageRecord): Promise<{ id: string; replayed: boolean }>;

  /**
   * After commit: sends one QUEUED row (test mode first, then the provider, with 15 seconds to answer)
   * and updates it to SENT, SKIPPED or FAILED with `sent_at` and `error_code`. No answer is FAILED
   * `TIMEOUT`, a thrown error FAILED `UNKNOWN` (its detail only in the log). Never throws, never retries.
   */
  abstract sendQueued(messageId: string, request: Omit<OutboundRequest, 'messageId'>): Promise<SendResult>;
}

/**
 * The Inc 2 default provider: sends nothing and answers SKIPPED `MOCK_PROVIDER`. It logs only the
 * masked number, the template and the length, never the text or the link (the old mock SMS logs the
 * whole body, so links must never go through it).
 */
@Injectable()
export class MockMessagingProvider implements MessagingProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockMessagingProvider');

  supports(channel: ProviderChannel): boolean {
    return channel === 'SMS' || channel === 'WHATSAPP';
  }

  async send(req: OutboundRequest): Promise<SendResult> {
    this.logger.log(JSON.stringify({ to: maskPhone(req.toE164), templateKey: req.templateKey, chars: req.text.length }));
    return { kind: 'SKIPPED', reason: 'MOCK_PROVIDER' };
  }
}

/**
 * STUB until the confirmation lane lands: writes no row and sends nothing. `record` answers
 * INTERNAL_ERROR `{ reason: 'NOT_IMPLEMENTED' }` (only the confirmation lane calls it), and
 * `sendQueued` answers SKIPPED `MOCK_PROVIDER` without calling a provider.
 */
@Injectable()
export class NoopMessagingService extends MessagingService {
  async record(_tx: Prisma.TransactionClient, _row: OutboundMessageRecord): Promise<{ id: string; replayed: boolean }> {
    throw new AppError('INTERNAL_ERROR', { reason: 'NOT_IMPLEMENTED' });
  }

  async sendQueued(_messageId: string, _request: Omit<OutboundRequest, 'messageId'>): Promise<SendResult> {
    return { kind: 'SKIPPED', reason: 'MOCK_PROVIDER' };
  }
}

/** Picks the provider from env `MESSAGING_PROVIDER` (default `mock`); an unknown name refuses to boot. */
export function chooseMessagingProvider(name: string | undefined, providers: { mock: MockMessagingProvider }): MessagingProvider {
  const wanted = (name ?? '').trim() || 'mock';
  if (wanted === 'mock') return providers.mock;
  throw new Error(`MESSAGING_PROVIDER "${wanted}" is not a known provider (known: ${MESSAGING_PROVIDER_NAMES.join(', ')})`);
}

/** Global, so the confirmation module and any later sender inject `MessagingService` without imports. */
@Global()
@Module({
  providers: [
    MockMessagingProvider,
    {
      provide: MESSAGING_PROVIDER,
      inject: [ConfigService, MockMessagingProvider],
      useFactory: (config: ConfigService, mock: MockMessagingProvider) =>
        chooseMessagingProvider(config.get<string>('MESSAGING_PROVIDER'), { mock }),
    },
    { provide: MessagingService, useClass: NoopMessagingService },
  ],
  exports: [MessagingService, MESSAGING_PROVIDER],
})
export class MessagingModule {}
