import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AuditActorKind } from '@prisma/client';
import type { AuditAction, AuditLogDto, Page } from '@smartfleet/shared-types';
import type { Actor } from '../../common/auth/actor';
import { RequestContext } from '../../common/context/request-context';
import { decodeCursor, invalidCursor, pageLimit, toPage } from '../../common/pagination/cursor';
import { toJsonSafe, toJsonSafeObject } from '../../common/security/json-safe';
import { PrismaService } from '../../prisma/prisma.service';

/** One audit row (API_CONTRACT §5.3, Appendix B). Write it in the same transaction as the change. */
export interface AuditEvent {
  action: AuditAction;
  actor: Actor;
  resourceType: string;
  /** The changed row's id (a UUID). Rows without one, such as a setting, put their key in `diff`. */
  resourceId?: string | null;
  /** The distributor the change concerns; defaults to a distributor actor's own. */
  distributorId?: string | null;
  /** Required for the actions marked * in Appendix B. */
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  /** The action's own facts, e.g. `order.cancel` `{ refunded, refundPaisa, startedRule }`. */
  diff?: Record<string, unknown>;
}

export interface AuditLogFilter {
  resourceType?: string;
  resourceId?: string;
  action?: string;
  actorUserId?: string;
  distributorId?: string;
  /** Inclusive start instant. */
  from?: Date;
  /** Exclusive end instant. */
  to?: Date;
  cursor?: string;
  limit?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 300;

type AuditRow = Prisma.AuditLogGetPayload<{ include: { actor: { select: { id: true; name: true } } } }>;

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Writes one audit row. Pass the transaction client so the row commits with the change, or not at
   * all. The IP, user agent and request id come from the request context, except that a CUSTOMER
   * actor's row never stores the IP or the user agent (API_CONTRACT §5.3; its request id is kept).
   * Secrets and BigInts in `before`/`after`/`diff` are made JSON-safe (money as digit strings).
   */
  async record(event: AuditEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const context = RequestContext.current();
    const { actor } = event;

    let actorKind: AuditActorKind;
    let actorUserId: string | null = null;
    let actorLabel: string | null = null;
    if (actor.kind === 'USER') {
      actorKind = 'USER';
      actorUserId = actor.userId;
    } else {
      actorKind = actor.kind;
      actorLabel = truncate(actor.label, 120);
      if (!actorLabel) throw new Error(`audit: a ${actor.kind} actor needs a label`);
    }

    const diff: Record<string, unknown> = { ...(event.diff ?? {}) };
    if (event.before !== undefined) diff.before = event.before;
    if (event.after !== undefined) diff.after = event.after;

    let resourceId = event.resourceId ?? null;
    if (resourceId !== null && !UUID.test(resourceId)) {
      // audit_logs.resource_id is a uuid column: keep the key, never fail the change for it.
      this.logger.warn(`audit ${event.action}: resourceId is not a UUID; kept as diff.resourceKey`);
      diff.resourceKey = resourceId;
      resourceId = null;
    }

    const safeDiff = toJsonSafe(diff);
    const hasDiff = safeDiff !== null && typeof safeDiff === 'object' && Object.keys(safeDiff).length > 0;

    await db.auditLog.create({
      data: {
        actorKind,
        actorUserId,
        actorLabel,
        action: event.action,
        resourceType: event.resourceType,
        resourceId,
        distributorId: event.distributorId ?? (actor.kind === 'USER' ? actor.distributorId ?? null : null),
        reason: truncate(event.reason, MAX_TEXT),
        diff: hasDiff ? (safeDiff as Prisma.InputJsonValue) : Prisma.DbNull,
        // A customer on the public link is not tracked by IP or device (CUSTOMER_PAGE §12).
        ip: actorKind === 'CUSTOMER' ? null : context?.ip ?? null,
        userAgent: actorKind === 'CUSTOMER' ? null : context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      },
    });
  }

  /** Office list, newest first, cursor-paged (API_CONTRACT §7.13). */
  async list(filter: AuditLogFilter = {}): Promise<Page<AuditLogDto>> {
    const limit = pageLimit(filter.limit);
    const where: Prisma.AuditLogWhereInput = {
      // Writers differ in letter case ('Payment', 'order', the migration's 'Distributor'), so a record's
      // history matches its resource type in any case: a distributor page asking for 'distributor'
      // also gets its wallet corrections and opening entry.
      ...(filter.resourceType ? { resourceType: { equals: filter.resourceType, mode: 'insensitive' as const } } : {}),
      ...(filter.resourceId ? { resourceId: filter.resourceId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(filter.distributorId ? { distributorId: filter.distributorId } : {}),
      ...(filter.from || filter.to
        ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
        : {}),
    };
    const cursor = decodeCursor(filter.cursor, 2);
    if (cursor) {
      const [at, id] = cursor;
      const atDate = new Date(String(at));
      if (Number.isNaN(atDate.getTime()) || typeof id !== 'string' || !UUID.test(id)) throw invalidCursor();
      where.AND = [{ OR: [{ createdAt: { lt: atDate } }, { createdAt: atDate, id: { lt: id } }] }];
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toPage(rows.map(toAuditLogDto), limit, (dto) => [dto.at, dto.id]);
  }
}

export function toAuditLogDto(row: AuditRow): AuditLogDto {
  const diff = row.diff;
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    actor: {
      kind: row.actorKind,
      ...(row.actorUserId ? { userId: row.actorUserId } : {}),
      ...(row.actor?.name ? { name: row.actor.name } : {}),
      ...(row.actorLabel ? { label: row.actorLabel } : {}),
    },
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    distributorId: row.distributorId,
    reason: row.reason,
    diff: diff !== null && typeof diff === 'object' && !Array.isArray(diff) ? toJsonSafeObject(diff as Record<string, unknown>) : null,
  };
}
