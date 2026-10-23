import { Injectable, Logger } from '@nestjs/common';
import { AlertSeverity, AlertType, OrderStatus } from '@prisma/client';
import { haversineKm } from '@smartfleet/shared-utils';
import { systemActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';

export type DispatchOutcome = { tripId: string } | { error: string };

/**
 * Automatic assignment (ADR-12). Off for the pilot (`dispatch.autoAssign.enabled = false`): the
 * processor does nothing, and `POST /dispatch/manual` answers 403 DISPATCH_AUTO_OFF. When switched on,
 * it picks the nearest online, available driver with a van and assigns through the one assignment
 * path (`OrdersService.assignDriver`), so the trip always starts at the distributor's store.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly orders: OrdersService,
    private readonly settings: SettingsService,
  ) {}

  isOn(): Promise<boolean> {
    return this.settings.get('dispatch.autoAssign.enabled');
  }

  /** `POST /dispatch/manual` (office): 403 DISPATCH_AUTO_OFF while automatic assignment is off. */
  async manual(orderId: string): Promise<DispatchOutcome> {
    if (!(await this.isOn())) throw new AppError('DISPATCH_AUTO_OFF');
    return this.dispatchOrder(orderId);
  }

  /** Assigns one PENDING order, or explains why not. Does nothing while the setting is off. */
  async dispatchOrder(orderId: string): Promise<DispatchOutcome> {
    if (!(await this.isOn())) return { error: 'AUTO_ASSIGN_OFF' };
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, distributor: { select: { homeStoreId: true } } },
    });
    if (!order || order.status !== OrderStatus.PENDING) return { error: 'ORDER_NOT_PENDING' };
    const storeId = order.distributor.homeStoreId;
    if (!storeId) return { error: 'DISTRIBUTOR_NO_STORE' };
    const stores = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(location) AS lat, ST_X(location) AS lng FROM stores WHERE id = ${storeId}::uuid`;
    const store = stores[0];
    if (!store) return { error: 'DISTRIBUTOR_NO_STORE' };

    // Online drivers who may take a job (ACTIVE, AVAILABLE) with an active van and a known position.
    const drivers = await this.prisma.$queryRaw<Array<{ id: string; lat: number; lng: number }>>`
      SELECT d.id, ST_Y(d.current_location) AS lat, ST_X(d.current_location) AS lng
      FROM drivers d
      JOIN users u ON u.id = d.user_id AND u.status = 'ACTIVE'
      JOIN vehicles v ON v.id = d.current_vehicle_id AND v.status = 'ACTIVE'
      WHERE d.is_online = TRUE AND d.availability = 'AVAILABLE' AND d.current_location IS NOT NULL`;
    const best = drivers
      .map((driver) => ({ id: driver.id, km: haversineKm({ lat: driver.lat, lng: driver.lng }, store) }))
      .sort((a, b) => a.km - b.km || a.id.localeCompare(b.id))[0];
    if (!best) {
      this.logger.warn(`No eligible driver for order ${orderId}`);
      await this.alerts.raise({
        alertType: AlertType.DISPATCH_NO_CANDIDATE,
        severity: AlertSeverity.CRITICAL,
        title: 'Order has no eligible driver',
        body: 'No online, available driver with a van could take this order.',
        resourceType: 'Order',
        resourceId: orderId,
        dedupeKey: { resourceType: 'Order', resourceId: orderId, alertType: AlertType.DISPATCH_NO_CANDIDATE },
      });
      return { error: 'NO_ELIGIBLE_CANDIDATE' };
    }
    const result = await this.orders.assignDriver(systemActor('job:dispatch'), orderId, { driverId: best.id });
    const assigned = result instanceof IdempotentResponse ? result.body : result;
    return { tripId: assigned.tripId };
  }
}
