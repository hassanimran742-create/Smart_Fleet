import { Injectable } from '@nestjs/common';
import { DriverAvailability, FillingOrderStatus, FillingServiceType, Prisma, UserStatus } from '@prisma/client';
import type { CreateFillingOrderInput } from '@smartfleet/shared-validation';
import type { Actor, UserActor } from '../../common/auth/actor';
import { canSeeRefill, type PolicyCaller } from '../../common/auth/policies';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LOCKING_TX, type Tx } from '../orders/support/tx';
import { sizeLabelOf } from '../pricing/size-label';
import { SettingsService } from '../settings/settings.service';
import { REFILL_VIEW_INCLUDE, toRefillView, type RefillView } from './refill.mapper';

/** The Inc 1 driver steps of a refill, each one status forward (API_CONTRACT §8.4). */
export type RefillStep = 'picked-empties' | 'at-station' | 'filled' | 'returned';

const STEPS: Record<RefillStep, { from: FillingOrderStatus; to: FillingOrderStatus }> = {
  'picked-empties': { from: FillingOrderStatus.ASSIGNED, to: FillingOrderStatus.EMPTIES_PICKED },
  'at-station': { from: FillingOrderStatus.EMPTIES_PICKED, to: FillingOrderStatus.AT_STATION },
  filled: { from: FillingOrderStatus.AT_STATION, to: FillingOrderStatus.FILLED },
  returned: { from: FillingOrderStatus.FILLED, to: FillingOrderStatus.RETURNED },
};

const CANCELLABLE: FillingOrderStatus[] = [FillingOrderStatus.PENDING, FillingOrderStatus.ASSIGNED];
const LIST_LIMIT = 200;

interface LockedRefill {
  id: string;
  distributorId: string;
  status: FillingOrderStatus;
  requestedCount: number;
  pickedUpEmptyCount: number | null;
  filledCount: number | null;
  assignedDriverId: string | null;
  distributor: { businessName: string };
  cylinderType: { name: string; weightKg: Prisma.Decimal };
}

/**
 * Refills, Inc 1 (ADR-16, API_CONTRACT §7.11, §8.4): one size, at most `refill.maxCylinders`, from the
 * distributor's store, and **no money** (no balance check, no ledger row, prices written and read as 0).
 * The office assigns and completes; only the assigned driver moves the steps; only the owner cancels,
 * and only before pickup. Do-it-yourself refills are retired (410).
 */
@Injectable()
export class FillingOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * `POST /filling-orders` (DISTRIBUTOR exact). Rules in order: an ACTIVE distributor; DIY is 410
   * REFILL_DIY_RETIRED; at most `refill.maxCylinders` (400 REFILL_TOO_MANY); the station exists and is
   * active; the pickup is the home store (a body value is ignored). Inc 1 doesn't read the
   * Idempotency-Key (no column for it before Inc 3). One transaction with `refill.create`.
   */
  async create(actor: UserActor, body: CreateFillingOrderInput): Promise<RefillView> {
    const distributorId = ownDistributorId(actor);
    const distributor = await this.prisma.distributor.findUnique({
      where: { id: distributorId },
      select: { id: true, status: true, homeStoreId: true, businessName: true },
    });
    if (!distributor) throw new AppError('NOT_FOUND');
    if (distributor.status !== 'ACTIVE') throw new AppError('DISTRIBUTOR_NOT_ACTIVE');
    if (body.serviceType === 'DIY') throw new AppError('REFILL_DIY_RETIRED');
    const max = await this.settings.get('refill.maxCylinders');
    if (body.requestedCount > max) throw new AppError('REFILL_TOO_MANY', { max });
    const station = await this.prisma.fillingStation.findUnique({ where: { id: body.fillingStationId as string }, select: { id: true, isActive: true } });
    if (!station) throw new AppError('NOT_FOUND', { field: 'fillingStationId' });
    if (!station.isActive) throw new AppError('REFILL_STATION_INACTIVE');
    if (!distributor.homeStoreId) throw new AppError('DISTRIBUTOR_NO_STORE');
    const type = await this.prisma.cylinderType.findUnique({ where: { id: body.cylinderTypeId }, select: { id: true, name: true, weightKg: true } });
    if (!type) throw new AppError('NOT_FOUND', { field: 'cylinderTypeId' });

    const id = await this.prisma.$transaction(async (tx) => {
      const refill = await tx.fillingOrder.create({
        data: {
          distributorId,
          fillingStationId: station.id,
          cylinderTypeId: type.id,
          requestedCount: body.requestedCount,
          serviceType: FillingServiceType.OUR_SERVICE,
          pricePerCylinderPaisa: 0n,
          totalCostPaisa: 0n,
          pickupStoreId: distributor.homeStoreId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'refill.create',
          actor,
          resourceType: 'refill',
          resourceId: refill.id,
          distributorId,
          diff: { distributor: distributor.businessName, count: body.requestedCount, size: sizeLabelOf(type) },
        },
        tx,
      );
      return refill.id;
    });
    return this.view(actor, id);
  }

  /** The refill lists (bare arrays, newest first): the shop's own, the driver's own, or the office's. */
  async list(caller: PolicyCaller, where: Prisma.FillingOrderWhereInput): Promise<RefillView[]> {
    const rows = await this.prisma.fillingOrder.findMany({
      where,
      include: REFILL_VIEW_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    });
    return rows.map((row) => toRefillView(row, caller));
  }

  /** `GET /filling-orders/:id` (`canSeeRefill`: the office, the owner, the assigned driver). */
  async byId(caller: PolicyCaller, id: string): Promise<RefillView> {
    const row = await this.prisma.fillingOrder.findUnique({ where: { id }, include: REFILL_VIEW_INCLUDE });
    return toRefillView(canSeeRefill(caller, row), caller);
  }

  /**
   * `PATCH /filling-orders/:id/assign` (office) `{ driverId }`, checked in order: an unknown refill
   * or driver is 404; PENDING (the same driver again: 200 `X-Already-Applied`), else 409
   * REFILL_WRONG_STEP; the driver ACTIVE and AVAILABLE; a van, saved as the refill's van. Audited
   * `refill.assign`.
   */
  async assign(actor: Actor, caller: PolicyCaller, id: string, driverId: string): Promise<RefillView | IdempotentResponse<RefillView>> {
    const applied = await this.prisma.$transaction(async (tx) => {
      const refill = await this.lock(tx, id);
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        select: { id: true, availability: true, currentVehicleId: true, user: { select: { name: true, status: true } } },
      });
      if (!driver) throw new AppError('NOT_FOUND', { field: 'driverId' });
      if (refill.status === FillingOrderStatus.ASSIGNED && refill.assignedDriverId === driverId) return false;
      if (refill.status !== FillingOrderStatus.PENDING) throw new AppError('REFILL_WRONG_STEP', { currentStatus: refill.status });
      if (driver.user.status !== UserStatus.ACTIVE || driver.availability !== DriverAvailability.AVAILABLE) {
        throw new AppError('ASSIGN_DRIVER_NOT_AVAILABLE', { driver: driver.user.name });
      }
      if (!driver.currentVehicleId) throw new AppError('ASSIGN_DRIVER_NO_VEHICLE', { driver: driver.user.name });
      await tx.fillingOrder.update({
        where: { id },
        data: { status: FillingOrderStatus.ASSIGNED, assignedDriverId: driver.id, assignedVehicleId: driver.currentVehicleId },
      });
      await this.audit.record(
        {
          action: 'refill.assign',
          actor,
          resourceType: 'refill',
          resourceId: id,
          distributorId: refill.distributorId,
          diff: {
            distributor: refill.distributor.businessName,
            count: refill.requestedCount,
            size: sizeLabelOf(refill.cylinderType),
            driver: driver.user.name,
            driverId: driver.id,
          },
        },
        tx,
      );
      return true;
    }, LOCKING_TX);
    const view = await this.view(caller, id);
    return applied ? view : alreadyApplied(view);
  }

  /**
   * A driver step (`picked-empties`, `at-station`, `filled`, `returned`): the assigned driver only
   * (404 for anyone else), from the step before (409 REFILL_WRONG_STEP), with `1 ≤ emptyCount ≤
   * requestedCount` and `0 ≤ filledCount ≤ pickedUpEmptyCount` (400 REFILL_INVALID_COUNT). The same
   * step again with the same count answers 200 `X-Already-Applied`. No money.
   */
  async step(actor: UserActor, id: string, step: RefillStep, count?: number): Promise<RefillView | IdempotentResponse<RefillView>> {
    const { from, to } = STEPS[step];
    const applied = await this.prisma.$transaction(async (tx) => {
      const refill = await this.lock(tx, id);
      if (!actor.driverId || refill.assignedDriverId !== actor.driverId) throw new AppError('NOT_FOUND');
      const stored = step === 'picked-empties' ? refill.pickedUpEmptyCount : step === 'filled' ? refill.filledCount : undefined;
      if (refill.status === to && (count === undefined || stored === count)) return false;
      if (refill.status !== from) throw new AppError('REFILL_WRONG_STEP', { currentStatus: refill.status });
      const data: Prisma.FillingOrderUpdateInput = { status: to };
      if (step === 'picked-empties') {
        if (count === undefined || count < 1 || count > refill.requestedCount) throw new AppError('REFILL_INVALID_COUNT');
        data.pickedUpEmptyCount = count;
      }
      if (step === 'filled') {
        if (count === undefined || count < 0 || count > (refill.pickedUpEmptyCount ?? 0)) throw new AppError('REFILL_INVALID_COUNT');
        data.filledCount = count;
      }
      await tx.fillingOrder.update({ where: { id }, data });
      return true;
    }, LOCKING_TX);
    const view = await this.view(actor, id);
    return applied ? view : alreadyApplied(view);
  }

  /**
   * `PATCH /filling-orders/:id/complete` (office): RETURNED → COMPLETED, audited `refill.complete`,
   * **no ledger row**. A repeat: 200 `X-Already-Applied`; any other status 409 REFILL_WRONG_STEP.
   */
  async complete(actor: Actor, caller: PolicyCaller, id: string): Promise<RefillView | IdempotentResponse<RefillView>> {
    const applied = await this.prisma.$transaction(async (tx) => {
      const refill = await this.lock(tx, id);
      if (refill.status === FillingOrderStatus.COMPLETED) return false;
      if (refill.status !== FillingOrderStatus.RETURNED) throw new AppError('REFILL_WRONG_STEP', { currentStatus: refill.status });
      await tx.fillingOrder.update({ where: { id }, data: { status: FillingOrderStatus.COMPLETED, completedAt: new Date() } });
      await this.audit.record(
        {
          action: 'refill.complete',
          actor,
          resourceType: 'refill',
          resourceId: id,
          distributorId: refill.distributorId,
          diff: { distributor: refill.distributor.businessName, count: refill.requestedCount, size: sizeLabelOf(refill.cylinderType) },
        },
        tx,
      );
      return true;
    }, LOCKING_TX);
    const view = await this.view(caller, id);
    return applied ? view : alreadyApplied(view);
  }

  /**
   * `PATCH /filling-orders/:id/cancel` (the owning distributor only; the office has no cancel)
   * `{ reason }`: only while PENDING or ASSIGNED (409 REFILL_NOT_CANCELLABLE). A repeat: 200
   * `X-Already-Applied`, no second audit row. Audited `refill.cancel`.
   */
  async cancel(actor: UserActor, id: string, reason: string): Promise<RefillView | IdempotentResponse<RefillView>> {
    const applied = await this.prisma.$transaction(async (tx) => {
      const refill = await this.lock(tx, id);
      if (refill.distributorId !== actor.distributorId) throw new AppError('NOT_FOUND');
      if (refill.status === FillingOrderStatus.CANCELLED) return false;
      if (!CANCELLABLE.includes(refill.status)) throw new AppError('REFILL_NOT_CANCELLABLE', { currentStatus: refill.status });
      await tx.fillingOrder.update({ where: { id }, data: { status: FillingOrderStatus.CANCELLED, cancellationReason: reason } });
      await this.audit.record(
        {
          action: 'refill.cancel',
          actor,
          resourceType: 'refill',
          resourceId: id,
          distributorId: refill.distributorId,
          reason,
          diff: { distributor: refill.distributor.businessName, count: refill.requestedCount, size: sizeLabelOf(refill.cylinderType) },
        },
        tx,
      );
      return true;
    }, LOCKING_TX);
    const view = await this.view(actor, id);
    return applied ? view : alreadyApplied(view);
  }

  /** Other PENDING refills whose station is within `radiusKm` of this one's (office batching aid). */
  async batchCandidates(id: string, radiusKm = 5) {
    const refill = await this.prisma.fillingOrder.findUnique({ where: { id }, select: { id: true, fillingStationId: true } });
    if (!refill) throw new AppError('NOT_FOUND');
    if (!refill.fillingStationId) return [];
    const stations = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(location) AS lat, ST_X(location) AS lng FROM filling_stations WHERE id = ${refill.fillingStationId}::uuid`;
    if (!stations[0]) return [];
    const { lat, lng } = stations[0];
    return this.prisma.$queryRaw<Array<{ id: string; distributor_id: string; requested_count: number; station_name: string; distance_km: number }>>`
      SELECT fo.id, fo.distributor_id, fo.requested_count, fs.name AS station_name,
             ST_DistanceSphere(fs.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) / 1000 AS distance_km
      FROM filling_orders fo
      JOIN filling_stations fs ON fs.id = fo.filling_station_id
      WHERE fo.status = 'PENDING'
        AND fo.id <> ${id}::uuid
        AND ST_DistanceSphere(fs.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) / 1000 <= ${radiusKm}
      ORDER BY distance_km ASC`;
  }

  // ---------- internals ----------

  private async lock(tx: Tx, id: string): Promise<LockedRefill> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM filling_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return tx.fillingOrder.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        distributorId: true,
        status: true,
        requestedCount: true,
        pickedUpEmptyCount: true,
        filledCount: true,
        assignedDriverId: true,
        distributor: { select: { businessName: true } },
        cylinderType: { select: { name: true, weightKg: true } },
      },
    });
  }

  private async view(caller: PolicyCaller, id: string): Promise<RefillView> {
    const row = await this.prisma.fillingOrder.findUniqueOrThrow({ where: { id }, include: REFILL_VIEW_INCLUDE });
    return toRefillView(row, caller);
  }
}
