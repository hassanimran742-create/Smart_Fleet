import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from './alerts.service';
import { AlertRule, AlertRuleKind, AlertSeverity, AlertType, Prisma } from '@prisma/client';

@Injectable()
export class AlertRulesService {
  constructor(
    private prisma: PrismaService,
    private alerts: AlertsService,
  ) {}

  list() {
    return this.prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(input: {
    name: string;
    ruleKind: AlertRuleKind;
    threshold: string | number;
    resourceId?: string;
    cylinderTypeId?: string;
    severity?: AlertSeverity;
    notes?: string;
    createdBy: string;
  }) {
    return this.prisma.alertRule.create({
      data: {
        name: input.name,
        ruleKind: input.ruleKind,
        threshold: BigInt(input.threshold),
        resourceId: input.resourceId,
        cylinderTypeId: input.cylinderTypeId,
        severity: input.severity ?? AlertSeverity.WARNING,
        notes: input.notes,
        createdBy: input.createdBy,
      },
    });
  }

  update(id: string, input: Partial<{
    name: string;
    threshold: string | number;
    severity: AlertSeverity;
    isActive: boolean;
    notes: string;
  }>) {
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

  remove(id: string) {
    return this.prisma.alertRule.delete({ where: { id } });
  }

  // Lazy evaluation: runs the active rules and raises (with dedupe) any
  // alerts whose condition is currently satisfied. Called by AlertsController
  // before returning the alert list so the operator always sees a fresh view.
  async evaluateAll() {
    const rules = await this.prisma.alertRule.findMany({ where: { isActive: true } });
    let raised = 0;
    for (const rule of rules) {
      try {
        if (await this.evaluateOne(rule)) raised += 1;
      } catch {
        // Skip rules that throw — log silently to avoid breaking the alerts page.
      }
    }
    return raised;
  }

  private async evaluateOne(rule: AlertRule): Promise<boolean> {
    switch (rule.ruleKind) {
      case AlertRuleKind.DISTRIBUTOR_BALANCE_LOW: {
        const where: Prisma.DistributorWhereInput = rule.resourceId
          ? { id: rule.resourceId }
          : { status: 'ACTIVE' };
        const distributors = await this.prisma.distributor.findMany({ where });
        let hit = false;
        for (const d of distributors) {
          if (d.advanceBalancePaisa < rule.threshold) {
            await this.alerts.raise({
              alertType: AlertType.DISTRIBUTOR_BALANCE_LOW,
              severity: rule.severity,
              title: `Low advance balance: ${d.businessName}`,
              body: `Advance balance ${Number(d.advanceBalancePaisa) / 100} PKR is below the configured threshold of ${Number(rule.threshold) / 100} PKR (rule "${rule.name}").`,
              resourceType: 'Distributor',
              resourceId: d.id,
              dedupeKey: { resourceType: 'Distributor', resourceId: d.id, alertType: AlertType.DISTRIBUTOR_BALANCE_LOW },
            });
            hit = true;
          }
        }
        if (hit) await this.touch(rule.id);
        return hit;
      }
      case AlertRuleKind.DISTRIBUTOR_CREDIT_OVER: {
        // advance_balance_paisa is negative when the distributor owes money;
        // -threshold means "we're carrying more than [threshold] of credit on their behalf".
        const where: Prisma.DistributorWhereInput = rule.resourceId ? { id: rule.resourceId } : {};
        const distributors = await this.prisma.distributor.findMany({ where });
        const negCap = -rule.threshold;
        let hit = false;
        for (const d of distributors) {
          if (d.advanceBalancePaisa < negCap) {
            await this.alerts.raise({
              alertType: AlertType.DISTRIBUTOR_CREDIT_OVER,
              severity: rule.severity,
              title: `Credit limit exceeded: ${d.businessName}`,
              body: `${d.businessName} owes ${Math.abs(Number(d.advanceBalancePaisa)) / 100} PKR, above the ${Number(rule.threshold) / 100} PKR limit (rule "${rule.name}").`,
              resourceType: 'Distributor',
              resourceId: d.id,
              dedupeKey: { resourceType: 'Distributor', resourceId: d.id, alertType: AlertType.DISTRIBUTOR_CREDIT_OVER },
            });
            hit = true;
          }
        }
        if (hit) await this.touch(rule.id);
        return hit;
      }
      case AlertRuleKind.STORE_STOCK_LOW: {
        // threshold = minimum FULL count expected at any store for the given cylinder type.
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
          if (BigInt(r.count) < rule.threshold) {
            await this.alerts.raise({
              alertType: AlertType.STORE_STOCK_LOW,
              severity: rule.severity,
              title: `Low stock at ${r.store_name}`,
              body: `Only ${r.count} full cylinders left at ${r.store_name}, below the ${rule.threshold} threshold (rule "${rule.name}").`,
              resourceType: 'Store',
              resourceId: r.store_id,
              dedupeKey: { resourceType: 'Store', resourceId: r.store_id, alertType: AlertType.STORE_STOCK_LOW },
            });
            hit = true;
          }
        }
        if (hit) await this.touch(rule.id);
        return hit;
      }
      case AlertRuleKind.SPECIAL_CLIENT: {
        // Raise an informational alert any time a "special" client places an order.
        if (!rule.resourceId) return false;
        const recent = await this.prisma.order.findMany({
          where: {
            clientId: rule.resourceId,
            createdAt: { gte: rule.lastTriggeredAt ?? new Date(0) },
          },
          include: { client: true },
          take: 5,
        });
        if (recent.length === 0) return false;
        for (const o of recent) {
          await this.alerts.raise({
            alertType: AlertType.SPECIAL_CLIENT,
            severity: rule.severity,
            title: `Order from VIP: ${o.client?.name ?? 'client'}`,
            body: `Special-attention client (rule "${rule.name}") placed order ${o.id.slice(0, 8)}.`,
            resourceType: 'Order',
            resourceId: o.id,
            dedupeKey: { resourceType: 'Order', resourceId: o.id, alertType: AlertType.SPECIAL_CLIENT },
          });
        }
        await this.touch(rule.id);
        return true;
      }
    }
  }

  private touch(ruleId: string) {
    return this.prisma.alertRule.update({
      where: { id: ruleId },
      data: { lastTriggeredAt: new Date() },
    });
  }
}
