import { Injectable } from '@nestjs/common';
import { AlertStatus, AlertType, FillingOrderStatus, LedgerEntryType, PaymentStatus, UserStatus } from '@prisma/client';
import type { AdminSummaryDto } from '@smartfleet/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { dayEndTodayCard } from '../day-end/day-end-today';
import { boardTabWhere, CANCELLED_FAILED_DAYS_BEFORE } from '../orders/order-tabs';
import { currentBusinessDays } from '../orders/support/business-day';
import { SettingsService } from '../settings/settings.service';

/**
 * `GET /admin/summary` (API_CONTRACT §7.13): the office Today page and the navigation badges. Read-only.
 * "Today" is the current business day (`day.timezone`, `day.cutoffLocalTime`: Asia/Karachi with a
 * 03:00 cut-off by default). The order figures use the board's tab definitions (G04-06), and
 * `costTakenTodayPaisa` comes from the ledger: Σ DEBIT_ORDER − Σ CREDIT_ORDER_REVERSAL for the day.
 * From Inc 2 it adds `problems`: the open customer problems (G07-22). From Inc 3 it adds `refills`: the
 * refills waiting for a driver (PENDING) and the oldest one, and `dayEnd`: the days waiting for approval and
 * the oldest of them (left out while `dayEnd.enabled` is off).
 */
@Injectable()
export class AdminSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async summary(now: Date = new Date()): Promise<AdminSummaryDto> {
    const [today, week] = await Promise.all([
      currentBusinessDays(this.settings, 0, now),
      currentBusinessDays(this.settings, CANCELLED_FAILED_DAYS_BEFORE, now),
    ]);
    const todayRange = { gte: today.start, lt: today.end };

    const [
      toCheck,
      oldestWaiting,
      approvedToday,
      needsDriver,
      oldestNeedsDriver,
      inProgress,
      placedToday,
      deliveredToday,
      costToday,
      missing,
      waitingToStart,
      drivers,
      problems,
      refills,
      dayEnd,
    ] = await Promise.all([
      this.prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
      this.prisma.payment.findFirst({ where: { status: PaymentStatus.PENDING }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } }),
      this.approvedToday(today.start, today.end),
      this.prisma.order.count({ where: boardTabWhere('needs-driver', today, week) }),
      this.prisma.order.findFirst({ where: boardTabWhere('needs-driver', today, week), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } }),
      this.prisma.order.count({ where: boardTabWhere('in-progress', today, week) }),
      this.prisma.order.count({ where: { createdAt: todayRange } }),
      this.prisma.order.count({ where: boardTabWhere('done-today', today, week) }),
      this.prisma.ledgerEntry.aggregate({
        where: { entryType: { in: [LedgerEntryType.DEBIT_ORDER, LedgerEntryType.CREDIT_ORDER_REVERSAL] }, createdAt: todayRange },
        _sum: { amountPaisa: true },
      }),
      this.missingPrices(),
      this.prisma.distributor.findMany({
        where: { status: 'PENDING' },
        orderBy: [{ businessName: 'asc' }, { id: 'asc' }],
        select: { id: true, businessName: true },
      }),
      this.driverCounts(),
      this.openProblems(),
      this.refillsNeedingDriver(),
      dayEndTodayCard(this.prisma, this.settings),
    ]);

    // Debits are negative, reversals positive: the cost taken is minus their sum.
    const costTaken = -(costToday._sum.amountPaisa ?? 0n);
    return {
      topups: {
        toCheck,
        oldestWaitingAt: oldestWaiting ? oldestWaiting.createdAt.toISOString() : null,
        approvedToday,
      },
      orders: {
        needsDriver,
        oldestNeedsDriverAt: oldestNeedsDriver ? oldestNeedsDriver.createdAt.toISOString() : null,
        inProgress,
        placedToday,
        deliveredToday,
        costTakenTodayPaisa: costTaken.toString(),
      },
      prices: { missing },
      distributors: { waitingToStart: waitingToStart.map((row) => ({ id: row.id, name: row.businessName })) },
      drivers,
      problems,
      refills,
      ...(dayEnd ? { dayEnd } : {}),
    };
  }

  /**
   * Top-ups approved in the business day (`completed_at` of SUCCESS requests), with the credited
   * amounts summed (the bank amount when the office typed one): the same figure as
   * `GET /admin/topups` `approvedToday` (G14-02).
   */
  private async approvedToday(start: Date, end: Date): Promise<{ count: number; totalPaisa: string }> {
    const rows = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.SUCCESS, completedAt: { gte: start, lt: end } },
      select: { amountPaisa: true, bankAmountPaisa: true },
    });
    const total = rows.reduce((sum, row) => sum + (row.bankAmountPaisa ?? row.amountPaisa), 0n);
    return { count: rows.length, totalPaisa: total.toString() };
  }

  /**
   * One row per ACTIVE distributor with at least one active zone without its price, sorted by name;
   * `zones` is how many such zones. Distributors waiting to start or suspended are left out.
   */
  private async missingPrices(): Promise<AdminSummaryDto['prices']['missing']> {
    const [activeZones, distributors] = await Promise.all([
      this.prisma.zone.count({ where: { isActive: true } }),
      this.prisma.distributor.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ businessName: 'asc' }, { id: 'asc' }],
        select: { id: true, businessName: true, _count: { select: { zonePrices: { where: { zone: { isActive: true } } } } } },
      }),
    ]);
    return distributors
      .map((row) => ({ distributorId: row.id, distributorName: row.businessName, zones: activeZones - row._count.zonePrices }))
      .filter((row) => row.zones > 0);
  }

  /**
   * [Inc 3] The Today card "Refills need a driver" (UX spec §3.4): the refills waiting for the office to
   * assign a driver (PENDING) and the oldest one's `createdAt` (0 and null when none waits).
   */
  private async refillsNeedingDriver(): Promise<NonNullable<AdminSummaryDto['refills']>> {
    const where = { status: FillingOrderStatus.PENDING };
    const [needsDriver, oldest] = await Promise.all([
      this.prisma.fillingOrder.count({ where }),
      this.prisma.fillingOrder.findFirst({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } }),
    ]);
    return { needsDriver, oldestNeedsDriverAt: oldest ? oldest.createdAt.toISOString() : null };
  }

  /**
   * [Inc 2] The open CUSTOMER_PROBLEM cases and the oldest one's `createdAt` (0 and null when none is
   * open): the Problems badge, the Today badge and the Customer problems card (API_CONTRACT §7.13, §9.6).
   */
  private async openProblems(): Promise<NonNullable<AdminSummaryDto['problems']>> {
    const where = { alertType: AlertType.CUSTOMER_PROBLEM, status: AlertStatus.OPEN };
    const [open, oldest] = await Promise.all([
      this.prisma.alert.count({ where }),
      this.prisma.alert.findFirst({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } }),
    ]);
    return { open, oldestOpenAt: oldest ? oldest.createdAt.toISOString() : null };
  }

  /**
   * Drivers whose account is active; on duty = online in the driver app (its On/Off duty switch) and
   * available (not on leave or off duty).
   */
  private async driverCounts(): Promise<{ onDuty: number; total: number }> {
    const [onDuty, total] = await Promise.all([
      this.prisma.driver.count({ where: { user: { status: UserStatus.ACTIVE }, isOnline: true, availability: 'AVAILABLE' } }),
      this.prisma.driver.count({ where: { user: { status: UserStatus.ACTIVE } } }),
    ]);
    return { onDuty, total };
  }
}
