import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { MessageStatus, Prisma } from '@prisma/client';
import { MESSAGE_FAIL_CODES, MESSAGE_SKIP_REASONS, type MessageFailCode, type MessageSkipReason } from '@smartfleet/shared-types';
import { redactPath } from '../../common/http/redact';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  MESSAGING_PROVIDER,
  MessagingService,
  type MessagingProvider,
  type OutboundMessageRecord,
  type OutboundRequest,
  type SendResult,
} from './messaging.contract';

/** How long a provider gets to answer before the send counts as FAILED `TIMEOUT` (CUSTOMER_PAGE §8). */
export const PROVIDER_TIMEOUT_MS = 15_000;
/** The longest log detail kept for a thrown provider error (redacted, never the text). */
const MAX_DETAIL = 200;

const TIMED_OUT = Symbol('timedOut');

/**
 * The message log (`outbound_messages`) and the after-commit send (CUSTOMER_PAGE §8, API_CONTRACT
 * §4.5). Test mode sits in front of the provider: while `messaging.testMode` is on, only numbers on
 * `messaging.allowlist` reach it and everyone else is SKIPPED `NOT_A_TEST_PHONE` without a call.
 *
 * - There is no queue, no sweeper and no retry: a row is sent once, right after the transaction that
 *   wrote it, and a row still QUEUED two minutes later counts as not sent (the shop shares the link).
 * - The provider gets 15 seconds; no answer is FAILED `TIMEOUT`, a thrown error FAILED `UNKNOWN`.
 * - Logs carry the message id and the code, never the text, the link or the full phone number.
 * - No money, ever: nothing here reaches the wallet.
 */
@Injectable()
export class MessagingServiceImpl extends MessagingService {
  private readonly logger = new Logger('Messaging');

  /** The provider's time to answer; tests shorten it. */
  sendTimeoutMs = PROVIDER_TIMEOUT_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
  ) {
    super();
  }

  /** The live provider's name, stored as `outbound_messages.provider` on an SMS row. */
  get providerName(): string {
    return this.provider.name;
  }

  async record(tx: Prisma.TransactionClient, row: OutboundMessageRecord): Promise<{ id: string; replayed: boolean }> {
    const id = randomUUID();
    const now = new Date();
    // ON CONFLICT DO NOTHING: a repeat of the same key never aborts the caller's transaction.
    const created = await tx.outboundMessage.createMany({
      data: [
        {
          id,
          channel: row.channel,
          provider: row.provider,
          toPhoneE164: row.toPhoneE164,
          templateKey: row.templateKey,
          locale: row.locale ?? 'en',
          bodyRedacted: row.bodyRedacted.slice(0, 320),
          status: row.status,
          idempotencyKey: row.idempotencyKey,
          confirmationId: row.confirmationId,
          tokenVersion: row.tokenVersion,
          orderId: row.orderId,
          distributorId: row.distributorId,
          createdByUserId: row.createdByUserId,
          createdAt: now,
          sentAt: row.status === MessageStatus.SENT ? now : null,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 1) return { id, replayed: false };
    const existing = await tx.outboundMessage.findUnique({ where: { idempotencyKey: row.idempotencyKey }, select: { id: true } });
    if (!existing) throw new Error(`outbound message ${row.idempotencyKey} could not be written`);
    return { id: existing.id, replayed: true };
  }

  async sendQueued(messageId: string, request: Omit<OutboundRequest, 'messageId'>): Promise<SendResult> {
    try {
      const row = await this.prisma.outboundMessage.findUnique({
        where: { id: messageId },
        select: { status: true, errorCode: true, providerMessageId: true },
      });
      if (!row) return { kind: 'FAILED', code: 'UNKNOWN' };
      // Sent once: a row that already left QUEUED answers what happened to it, with no second call.
      if (row.status !== MessageStatus.QUEUED) return resultOfRow(row);

      const result = await this.deliver(messageId, request);
      const now = new Date();
      await this.prisma.outboundMessage.updateMany({
        where: { id: messageId, status: MessageStatus.QUEUED },
        data:
          result.kind === 'SENT'
            ? { status: MessageStatus.SENT, providerMessageId: result.providerMessageId, sentAt: now, errorCode: null }
            : result.kind === 'SKIPPED'
              ? { status: MessageStatus.SKIPPED, errorCode: result.reason }
              : { status: MessageStatus.FAILED, errorCode: result.code },
      });
      if (result.kind === 'FAILED') {
        this.logger.error(`message ${messageId} was not sent: ${result.code}${result.detail ? ` (${safeDetail(result.detail)})` : ''}`);
      }
      return result;
    } catch (error) {
      // The send itself never throws to its caller (a finished delivery must stay finished).
      this.logger.error(`message ${messageId}: the send could not be recorded (${errorName(error)})`);
      return { kind: 'FAILED', code: 'UNKNOWN' };
    }
  }

  /** Test mode first, then the provider with its time limit. */
  private async deliver(messageId: string, request: Omit<OutboundRequest, 'messageId'>): Promise<SendResult> {
    if (await this.settings.get('messaging.testMode')) {
      const allowlist = await this.settings.get('messaging.allowlist');
      if (!allowlist.includes(request.toE164)) return { kind: 'SKIPPED', reason: 'NOT_A_TEST_PHONE' };
    }
    if (!this.provider.supports(request.channel)) {
      return { kind: 'FAILED', code: 'REJECTED', detail: `the provider does not send ${request.channel}` };
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const answer = await Promise.race([
        this.provider.send({ messageId, ...request }),
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), this.sendTimeoutMs);
        }),
      ]);
      if (answer === TIMED_OUT) return { kind: 'FAILED', code: 'TIMEOUT', detail: `no answer in ${this.sendTimeoutMs} ms` };
      return checkedResult(answer);
    } catch (error) {
      return { kind: 'FAILED', code: 'UNKNOWN', detail: errorDetail(error) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** A provider's answer, or FAILED `UNKNOWN` when it isn't one of the three shapes. */
function checkedResult(answer: unknown): SendResult {
  const value = answer as Partial<Record<'kind' | 'providerMessageId' | 'reason' | 'code' | 'detail', unknown>> | null;
  if (value?.kind === 'SENT' && typeof value.providerMessageId === 'string' && value.providerMessageId) {
    return { kind: 'SENT', providerMessageId: value.providerMessageId.slice(0, 200) };
  }
  if (value?.kind === 'SKIPPED' && (MESSAGE_SKIP_REASONS as readonly unknown[]).includes(value.reason)) {
    return { kind: 'SKIPPED', reason: value.reason as MessageSkipReason };
  }
  if (value?.kind === 'FAILED' && (MESSAGE_FAIL_CODES as readonly unknown[]).includes(value.code)) {
    return { kind: 'FAILED', code: value.code as MessageFailCode, ...(typeof value.detail === 'string' ? { detail: value.detail } : {}) };
  }
  return { kind: 'FAILED', code: 'UNKNOWN', detail: 'the provider gave an answer of no known shape' };
}

/** What happened to a row that already left QUEUED. */
function resultOfRow(row: { status: MessageStatus; errorCode: string | null; providerMessageId: string | null }): SendResult {
  if (row.status === MessageStatus.SENT || row.status === MessageStatus.DELIVERED) {
    return { kind: 'SENT', providerMessageId: row.providerMessageId ?? '' };
  }
  if (row.status === MessageStatus.SKIPPED) {
    const reason = (MESSAGE_SKIP_REASONS as readonly string[]).includes(row.errorCode ?? '') ? row.errorCode : 'MOCK_PROVIDER';
    return { kind: 'SKIPPED', reason: reason as MessageSkipReason };
  }
  const code = (MESSAGE_FAIL_CODES as readonly string[]).includes(row.errorCode ?? '') ? row.errorCode : 'UNKNOWN';
  return { kind: 'FAILED', code: code as MessageFailCode };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** A detail fit for the log: confirmation tokens redacted, links cut, at most 200 characters. */
function safeDetail(detail: string): string {
  return redactPath(detail)
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\+?\d{10,15}/g, '[number]')
    .slice(0, MAX_DETAIL);
}
