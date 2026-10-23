import { Injectable } from '@nestjs/common';
import { AlertStatus, AlertType, Prisma, UserRole } from '@prisma/client';
import type { CaseDto, CaseStatus, ConfirmationResponse, Page } from '@smartfleet/shared-types';
import { formatNo } from '@smartfleet/shared-utils';
import type { UserActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { decodeCursor, invalidCursor, toPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANSWERS: readonly string[] = ['YES', 'PARTLY', 'NO', 'OTHER'];

/** The one alert type that is a case (API_CONTRACT §9.6). */
const CASE_TYPE = AlertType.CUSTOMER_PROBLEM;

type CaseRow = Prisma.AlertGetPayload<{ select: typeof CASE_SELECT }>;
const CASE_SELECT = {
  id: true,
  status: true,
  resourceId: true,
  distributorId: true,
  context: true,
  createdAt: true,
  resolvedAt: true,
  resolvedByUserId: true,
  resolutionNote: true,
} satisfies Prisma.AlertSelect;

interface CaseContextRead {
  orderId?: unknown;
  orderShortCode?: unknown;
  answer?: unknown;
  comment?: unknown;
}

/**
 * Customer problems (cases, API_CONTRACT §9.6): CUSTOMER_PROBLEM alerts opened by a customer's answer in
 * its own transaction (ConfirmationService.record). Only the office closes one, with a 5–300
 * character note, once; the close is audited. **No money action exists** here or anywhere for a case.
 */
@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** `GET /alerts?type=CUSTOMER_PROBLEM&status=…` (office): OPEN oldest first; RESOLVED newest resolved first. */
  async list(query: { status: CaseStatus; cursor?: string | null; limit: number }, viewer: UserActor): Promise<Page<CaseDto>> {
    return this.page({ status: query.status, cursor: query.cursor, limit: query.limit }, viewer);
  }

  /** `GET /alerts/mine` (the shop): its OPEN cases, oldest first, with no actions. */
  async mine(distributorId: string, query: { cursor?: string | null; limit: number }, viewer: UserActor): Promise<Page<CaseDto>> {
    return this.page({ status: 'OPEN', cursor: query.cursor, limit: query.limit, distributorId }, viewer);
  }

  /**
   * `POST /alerts/:id/resolve` (office) `{ note }`: one transaction locks the case and moves it OPEN →
   * RESOLVED with who and the note, plus the `case.resolve` audit row (the note as its reason). Already
   * resolved by the caller: the case unchanged, X-Already-Applied. By someone else: 409
   * CASE_ALREADY_RESOLVED naming them. An id that isn't a case: 404.
   */
  async resolve(id: string, note: string, actor: UserActor): Promise<CaseDto | IdempotentResponse<CaseDto>> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string; alertType: string; status: string; resolvedByUserId: string | null }>>`
          SELECT id, alert_type::text AS "alertType", status::text AS status, resolved_by_user_id AS "resolvedByUserId"
          FROM alerts WHERE id = ${id}::uuid FOR UPDATE`;
        const alert = locked[0];
        if (!alert || alert.alertType !== CASE_TYPE) throw new AppError('NOT_FOUND');
        if (alert.status === AlertStatus.RESOLVED) {
          if (alert.resolvedByUserId === actor.userId) return 'already' as const;
          const by = alert.resolvedByUserId
            ? ((await tx.user.findUnique({ where: { id: alert.resolvedByUserId }, select: { name: true } }))?.name ?? 'the office')
            : 'the office';
          throw new AppError('CASE_ALREADY_RESOLVED', { by, currentStatus: AlertStatus.RESOLVED });
        }
        const now = new Date();
        const moved = await tx.alert.updateMany({
          where: { id, alertType: CASE_TYPE, status: { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] } },
          data: { status: AlertStatus.RESOLVED, resolvedAt: now, resolvedByUserId: actor.userId, resolutionNote: note },
        });
        if (moved.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
        const row = await tx.alert.findUniqueOrThrow({ where: { id }, select: { distributorId: true, resourceId: true } });
        await this.audit.record(
          {
            action: 'case.resolve',
            actor,
            resourceType: 'Alert',
            resourceId: id,
            distributorId: row.distributorId,
            reason: note,
            diff: { orderId: row.resourceId },
          },
          tx,
        );
        return 'resolved' as const;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    const dto = await this.one(id, actor);
    return outcome === 'already' ? alreadyApplied(dto) : dto;
  }

  /** One case as a CaseDto. */
  async one(id: string, viewer: UserActor): Promise<CaseDto> {
    const row = await this.prisma.alert.findFirst({ where: { id, alertType: CASE_TYPE }, select: CASE_SELECT });
    if (!row) throw new AppError('NOT_FOUND');
    const [dto] = await this.toDtos([row], viewer);
    return dto;
  }

  private async page(
    q: { status: CaseStatus; cursor?: string | null; limit: number; distributorId?: string },
    viewer: UserActor,
  ): Promise<Page<CaseDto>> {
    const open = q.status === 'OPEN';
    const where: Prisma.AlertWhereInput = {
      alertType: CASE_TYPE,
      // A case is only ever OPEN or RESOLVED; the legacy acknowledge route refuses cases.
      status: open ? { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] } : AlertStatus.RESOLVED,
      ...(q.distributorId ? { distributorId: q.distributorId } : {}),
    };
    const cursor = decodeCursor(q.cursor, 2);
    if (cursor) {
      const [at, cursorId] = cursor;
      const atDate = new Date(String(at));
      if (Number.isNaN(atDate.getTime()) || typeof cursorId !== 'string' || !UUID.test(cursorId)) throw invalidCursor();
      where.AND = open
        ? [{ OR: [{ createdAt: { gt: atDate } }, { createdAt: atDate, id: { gt: cursorId } }] }]
        : [{ OR: [{ resolvedAt: { lt: atDate } }, { resolvedAt: atDate, id: { lt: cursorId } }] }];
    }
    const rows = await this.prisma.alert.findMany({
      where,
      select: CASE_SELECT,
      orderBy: open ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const dtos = await this.toDtos(rows, viewer);
    return toPage(dtos, q.limit, (dto) => [open ? dto.openedAt : (dto.resolvedAt ?? dto.openedAt), dto.id]);
  }

  private async toDtos(rows: CaseRow[], viewer: UserActor): Promise<CaseDto[]> {
    if (rows.length === 0) return [];
    const orderIds = [...new Set(rows.map((row) => orderIdOf(row)).filter((id): id is string => !!id))];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderNo: true,
        distributorId: true,
        client: { select: { name: true } },
        distributor: { select: { id: true, code: true, businessName: true } },
      },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const resolverIds = [...new Set(rows.map((row) => row.resolvedByUserId).filter((id): id is string => !!id))];
    const resolvers = resolverIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, name: true } })
      : [];
    const resolverById = new Map(resolvers.map((user) => [user.id, user]));
    const office = viewer.role === UserRole.SUPER_ADMIN;

    return rows.map((row) => {
      const context = (row.context ?? {}) as CaseContextRead;
      const orderId = orderIdOf(row) ?? '';
      const order = orderById.get(orderId);
      const status: CaseStatus = row.status === AlertStatus.RESOLVED ? 'RESOLVED' : 'OPEN';
      const answer = (typeof context.answer === 'string' && ANSWERS.includes(context.answer) ? context.answer : 'OTHER') as ConfirmationResponse;
      const resolver = row.resolvedByUserId ? resolverById.get(row.resolvedByUserId) : undefined;
      return {
        id: row.id,
        status,
        order: {
          id: orderId,
          shortCode: order
            ? formatNo(order.distributor.code, 'ORDER', order.orderNo)
            : typeof context.orderShortCode === 'string'
              ? context.orderShortCode
              : '',
        },
        answer,
        comment: typeof context.comment === 'string' ? context.comment : null,
        customerName: order?.client.name ?? '',
        distributor: { id: order?.distributor.id ?? row.distributorId ?? '', businessName: order?.distributor.businessName ?? '' },
        openedAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
        resolvedBy: row.resolvedByUserId ? { id: row.resolvedByUserId, name: resolver?.name ?? '' } : null,
        resolutionNote: row.resolutionNote,
        allowedActions: office && status === 'OPEN' ? ['RESOLVE'] : [],
      } satisfies CaseDto;
    });
  }
}

function orderIdOf(row: Pick<CaseRow, 'resourceId' | 'context'>): string | null {
  const context = (row.context ?? {}) as CaseContextRead;
  if (row.resourceId) return row.resourceId;
  return typeof context.orderId === 'string' ? context.orderId : null;
}
