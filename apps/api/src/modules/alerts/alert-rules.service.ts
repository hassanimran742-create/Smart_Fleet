import { Injectable, Logger } from '@nestjs/common';
import { AlertRule, AlertRuleKind, AlertSeverity, AlertType, DistributorStatus, Prisma } from '@prisma/client';
import { formatRs } from '@smartfleet/shared-utils';
import {
  RETIRED_ALERT_RULE_KIND as RETIRED_RULE_KIND,
  type CreateAlertRuleInput,
  type UpdateAlertRuleInput,
} from '@smartfleet/shared-validation';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from './alerts.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Office alert rules, evaluated lazily when the office opens the alerts list (no worker needed).
 * `threshold` is paisa for DISTRIBUTOR_BALANCE_LOW and a full-cylinder count for STORE_STOCK_LOW.
 * DISTRIBUTOR_CREDIT_OVER is retired (API_CONTRACT §7.2, DATA_MODEL §3.7): a balance can't go
 * negative, so such a rule can't be created or set active, and the evaluator never runs one.
 * Raised alerts carry codes and values in `context`; their English title and body are a fallback.
 */
@Injectable()
export class AlertRulesService {
  private readonly logger = new Logger(AlertRulesService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: AlertsService,
  ) {}

  list() {
    return this.prisma.alertRule.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  create(input: CreateAlertRuleInput, createdBy: string) {
    return this.prisma.alertRule.create({
      data: {
        name: input.name,
        ruleKind: input.ruleKind,
        threshold: BigInt(input.threshold),
        resourceId: input.resourceId,
        cylinderTypeId: input.cylinderTypeId,
        severity: input.severity ?? AlertSeverity.WARNING,
        notes: input.notes,
        createdBy,
      },
    });
  }

  async update(id: string, input: UpdateAlertRuleInput) {
    const rule = await this.byId(id);
    if (rule.ruleKind === RETIRED_RULE_KIND && input.isActive === true) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'isActive', code: 'NOT_ALLOWED', message: validationMessage('NOT_ALLOWED') }],
      });
    }
    return this.prisma.alertRule.update({
      where: { id },
      data: {
        name: input.name,
        threshold: input.threshold !== undefined ? BigInt(input.threshold) : undefined,
        severity: input.severity,
        isActive: input.isActive,
        notes: input.notes,
      },
    });
  }

  async remove(id: string) {
    await this.byId(id);
    return this.prisma.alertRule.delete({ where: { id } });
  }

  /**
   * Runs the active rules and raises (deduplicated) any alert whose condition holds now. Returns how
   * many rules fired. A rule that fails is logged and skipped, so the alerts list always loads.
   */
  async evaluateAll(): Promise<number> {
    const rules = await this.prisma.alertRule.findMany({
      where: { isActive: true, ruleKind: { not: RETIRED_RULE_KIND } },
    });
    let raised = 0;
    for (const rule of rules) {
      try {
        if (await this.evaluateOne(rule)) raised += 1;
      } catch (error) {
        this.logger.warn(`alert rule ${rule.id} (${rule.ruleKind}) failed: ${(error as Error).message}`);
      }
    }
    return raised;
  }

  private async byId(id: string): Promise<AlertRule> {
    const rule = UUID.test(id) ? await this.prisma.alertRule.findUnique({ where: { id } }) : null;
    if (!rule) throw new AppError('NOT_FOUND');
    return rule;
  }

  private async evaluateOne(rule: AlertRule): Promise<boolean> {
    switch (rule.ruleKind) {
      case AlertRuleKind.DISTRIBUTOR_BALANCE_LOW:
        return this.balanceLow(rule);
      case AlertRuleKind.STORE_STOCK_LOW:
        return this.stockLow(rule);
      case AlertRuleKind.SPECIAL_CLIENT:
        return this.specialClient(rule);
      case AlertRuleKind.DISTRIBUTOR_CREDIT_OVER:
        // Retired: balances can't go negative, so this kind never runs.
        return false;
    }
  }

  private async balanceLow(rule: AlertRule): Promise<boolean> {
    const where: Prisma.DistributorWhereInput = rule.resourceId ? { id: rule.resourceId } : { status: DistributorStatus.ACTIVE };
    const distributors = await this.prisma.distributor.findMany({
      where,
      select: { id: true, businessName: true, advanceBalancePaisa: true },
    });
    let hit = false;
    for (const d of distributors) {
      if (d.advanceBalancePaisa >= rule.threshold) continue;
      await this.alerts.raise({
        alertType: AlertType.DISTRIBUTOR_BALANCE_LOW,
        severity: rule.severity,
        title: `Low balance: ${d.businessName}`,
        body: `The balance is ${formatRs(d.advanceBalancePaisa)}, below ${formatRs(rule.threshold)} (rule "${rule.name}").`,
        resourceType: 'Distributor',
        resourceId: d.id,
        context: {
          ruleId: rule.id,
          distributorId: d.id,
          balancePaisa: d.advanceBalancePaisa.toString(),
          thresholdPaisa: rule.threshold.toString(),
        },
        dedupeKey: { resourceType: 'Distributor', resourceId: d.id, alertType: AlertType.DISTRIBUTOR_BALANCE_LOW },
      });
      hit = true;
    }
    if (hit) await this.touch(rule.id);
    return hit;
  }

  private async stockLow(rule: AlertRule): Promise<boolean> {
    // threshold = the fewest FULL cylinders of one size a store should have.
    if (!rule.cylinderTypeId) return false;
    const rows: { store_id: string; store_name: string; count: number }[] = rule.resourceId
      ? await this.prisma.$queryRaw`
        SELECT s.id AS store_id, s.name AS store_name, COALESCE(SUM(il.count), 0)::int AS count
        FROM stores s
        LEFT JOIN inventory_lots il
          ON il.holder_type = 'STORE' AND il.holder_id = s.id
         AND il.cylinder_type_id = ${rule.cylinderTypeId}::uuid
         AND il.state = 'FULL'
        WHERE s.id = ${rule.resourceId}::uuid
        GROUP BY s.id, s.name
      `
      : await this.prisma.$queryRaw`
        SELECT s.id AS store_id, s.name AS store_name, COALESCE(SUM(il.count), 0)::int AS count
        FROM stores s
        LEFT JOIN inventory_lots il
          ON il.holder_type = 'STORE' AND il.holder_id = s.id
         AND il.cylinder_type_id = ${rule.cylinderTypeId}::uuid
         AND il.state = 'FULL'
        WHERE s.is_active = TRUE
        GROUP BY s.id, s.name
      `;
    let hit = false;
    for (const r of rows) {
      if (BigInt(r.count) >= rule.threshold) continue;
      await this.alerts.raise({
        alertType: AlertType.STORE_STOCK_LOW,
        severity: rule.severity,
        title: `Low stock at ${r.store_name}`,
        body: `Only ${r.count} full cylinders left at ${r.store_name}, below ${rule.threshold} (rule "${rule.name}").`,
        resourceType: 'Store',
        resourceId: r.store_id,
        context: { ruleId: rule.id, storeId: r.store_id, cylinderTypeId: rule.cylinderTypeId, count: r.count, threshold: Number(rule.threshold) },
        dedupeKey: { resourceType: 'Store', resourceId: r.store_id, alertType: AlertType.STORE_STOCK_LOW },
      });
      hit = true;
    }
    if (hit) await this.touch(rule.id);
    return hit;
  }

  private async specialClient(rule: AlertRule): Promise<boolean> {
    // An informational alert whenever a "special" client places an order.
    if (!rule.resourceId) return false;
    const recent = await this.prisma.order.findMany({
      where: { clientId: rule.resourceId, createdAt: { gte: rule.lastTriggeredAt ?? new Date(0) } },
      select: { id: true, clientId: true, client: { select: { name: true } } },
      take: 5,
    });
    if (recent.length === 0) return false;
    for (const o of recent) {
      await this.alerts.raise({
        alertType: AlertType.SPECIAL_CLIENT,
        severity: rule.severity,
        title: `Order from ${o.client?.name ?? 'a special customer'}`,
        body: `A customer marked for special attention placed an order (rule "${rule.name}").`,
        resourceType: 'Order',
        resourceId: o.id,
        context: { ruleId: rule.id, orderId: o.id, clientId: o.clientId },
        dedupeKey: { resourceType: 'Order', resourceId: o.id, alertType: AlertType.SPECIAL_CLIENT },
      });
    }
    await this.touch(rule.id);
    return true;
  }

  private touch(ruleId: string) {
    return this.prisma.alertRule.update({ where: { id: ruleId }, data: { lastTriggeredAt: new Date() } });
  }
}
