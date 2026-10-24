import { Injectable } from '@nestjs/common';
import { Alert, AlertSeverity, AlertStatus, AlertType, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Customer problems (cases) arrive as their own alert type in Inc 2 (API_CONTRACT §9.6). The legacy
 * alert routes never list, acknowledge or resolve them: a case closes only with a note.
 */
export const CASE_ALERT_TYPE = 'CUSTOMER_PROBLEM';

/** The alert types the legacy list and counts show: every type except cases. */
const LEGACY_ALERT_TYPES = (Object.values(AlertType) as string[]).filter((type) => type !== CASE_ALERT_TYPE) as AlertType[];

export interface RaiseAlertInput {
  alertType: AlertType;
  severity?: AlertSeverity;
  /** English fallback only: apps render the title and body from `alertType` and `context` (ADR-18). */
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  /** [Inc 2] The distributor the alert belongs to, so the shop sees its own cases (`GET /alerts/mine`). */
  distributorId?: string;
  /** Codes and values the apps render from; never free English. */
  context?: Prisma.InputJsonValue;
  /** With a key, an OPEN alert for the same resource and type is updated instead of a new one. */
  dedupeKey?: { resourceType?: string; resourceId?: string; alertType: AlertType };
  /**
   * The statuses the dedupe looks at; OPEN when left out. VAN_NOT_EMPTY passes OPEN and ACKNOWLEDGED (one
   * unresolved alert per van, API_CONTRACT §9.9): a new raise only refreshes that alert's context and
   * keeps its status.
   */
  dedupeStatuses?: readonly AlertStatus[];
}

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  /** The legacy office list (`GET /alerts`): newest first by severity, cases left out, at most 200. */
  list(opts: { status?: AlertStatus; severity?: AlertSeverity } = {}) {
    return this.prisma.alert.findMany({
      where: {
        alertType: { in: LEGACY_ALERT_TYPES },
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.severity ? { severity: opts.severity } : {}),
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
  }

  /** OPEN legacy alerts (the navigation badge). */
  unreadCount() {
    return this.prisma.alert.count({ where: { status: AlertStatus.OPEN, alertType: { in: LEGACY_ALERT_TYPES } } });
  }

  /**
   * Raises an alert, or with `dedupeKey` refreshes the OPEN one for the same resource and type. Pass
   * the caller's transaction to raise it with the change that caused it (it then commits or rolls back
   * with it); without one, the find-or-update and the create run in their own transaction.
   */
  async raise(input: RaiseAlertInput, tx?: Prisma.TransactionClient): Promise<Alert> {
    if (tx) return this.raiseOn(tx, input);
    if (input.dedupeKey) return this.prisma.$transaction((inner) => this.raiseOn(inner, input));
    return this.raiseOn(this.prisma, input);
  }

  /** `PATCH /alerts/:id/acknowledge`: OPEN → ACKNOWLEDGED; a repeat is 200 with X-Already-Applied. */
  async acknowledge(id: string): Promise<Alert | IdempotentResponse<Alert>> {
    const alert = await this.legacyAlert(id);
    if (alert.status === AlertStatus.ACKNOWLEDGED) return alreadyApplied(alert);
    if (alert.status !== AlertStatus.OPEN) throw new AppError('CONFLICT_STALE_STATE', { currentStatus: alert.status });
    const updated = await this.prisma.alert.updateMany({
      where: { id, status: AlertStatus.OPEN },
      data: { status: AlertStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
    });
    if (updated.count !== 1) return this.repeatOf(id, AlertStatus.ACKNOWLEDGED);
    return this.legacyAlert(id);
  }

  /** `PATCH /alerts/:id/resolve`: OPEN or ACKNOWLEDGED → RESOLVED; a repeat is 200 with X-Already-Applied. */
  async resolve(id: string): Promise<Alert | IdempotentResponse<Alert>> {
    const alert = await this.legacyAlert(id);
    if (alert.status === AlertStatus.RESOLVED) return alreadyApplied(alert);
    const updated = await this.prisma.alert.updateMany({
      where: { id, status: { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] } },
      data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
    });
    if (updated.count !== 1) return this.repeatOf(id, AlertStatus.RESOLVED);
    return this.legacyAlert(id);
  }

  private async raiseOn(db: Prisma.TransactionClient, input: RaiseAlertInput): Promise<Alert> {
    if (input.dedupeKey) {
      const existing = await db.alert.findFirst({
        where: {
          alertType: input.dedupeKey.alertType,
          resourceType: input.dedupeKey.resourceType,
          resourceId: input.dedupeKey.resourceId,
          status: { in: [...(input.dedupeStatuses ?? [AlertStatus.OPEN])] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (existing) {
        return db.alert.update({ where: { id: existing.id }, data: { updatedAt: new Date(), context: input.context } });
      }
    }
    return db.alert.create({
      data: {
        alertType: input.alertType,
        severity: input.severity ?? AlertSeverity.WARNING,
        title: input.title,
        body: input.body,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        distributorId: input.distributorId,
        context: input.context,
      },
    });
  }

  /** An alert the legacy routes may touch: an unknown id or a case is 404 NOT_FOUND. */
  private async legacyAlert(id: string): Promise<Alert> {
    const alert = UUID.test(id) ? await this.prisma.alert.findUnique({ where: { id } }) : null;
    if (!alert || (alert.alertType as string) === CASE_ALERT_TYPE) throw new AppError('NOT_FOUND');
    return alert;
  }

  /** The loser of a race: X-Already-Applied when the other request reached the same state. */
  private async repeatOf(id: string, target: AlertStatus): Promise<IdempotentResponse<Alert>> {
    const alert = await this.legacyAlert(id);
    if (alert.status === target) return alreadyApplied(alert);
    throw new AppError('CONFLICT_STALE_STATE', { currentStatus: alert.status });
  }
}
