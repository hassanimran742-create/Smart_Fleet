import { Injectable } from '@nestjs/common';
import { DriverAvailability, FillingOrderStatus, FillingServiceType, Prisma, UserStatus } from '@prisma/client';
import type { RefillAdvanceTarget } from '@smartfleet/shared-types';
import { REFILL_IDEMPOTENCY_FIELDS, type CreateFillingOrderInput } from '@smartfleet/shared-validation';
import type { Actor, UserActor } from '../../common/auth/actor';
import { canSeeRefill, type PolicyCaller } from '../../common/auth/policies';
import { ownDistributorId, ownDriverId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { alreadyApplied, assertSameRequest, replayed, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LOCKING_TX, type Tx } from '../orders/support/tx';
import { sizeLabelOf } from '../pricing/size-label';
import { SettingsService } from '../settings/settings.service';
import { REFILL_VIEW_INCLUDE, refillShortCode, toRefillView, type RefillView } from './refill.mapper';

const CANCELLABLE: FillingOrderStatus[] = [FillingOrderStatus.PENDING, FillingOrderStatus.ASSIGNED];
const LIST_LIMIT = 200;
const CLIENT_REQUEST_KEY = 'filling_orders_distributor_id_client_request_id_key';

/** "Leave store" and "Leave station" (API_CONTRACT §10.1 `POST /filling-orders/:id/advance`): the step each one leaves. */
const ADVANCE_FROM: Record<RefillAdvanceTarget, FillingOrderStatus> = {
  EMPTIES_PICKED: FillingOrderStatus.ASSIGNED,
  FILLED: FillingOrderStatus.AT_STATION,
};

interface LockedRefill {
  id: string;
  distributorId: string;
  status: FillingOrderStatus;
  requestedCount: number;
  assignedDriverId: string | null;
  refillNo: number | null;
  distributor: { businessName: string; code: string };
  cylinderType: { name: string; weightKg: Prisma.Decimal };
}

/**
 * Refills (ADR-16; API_CONTRACT §7.11, and §10.1 from Inc 3): one size, at most `refill.maxCylinders`, from
 * the distributor's store, and **no money** (no balance check, no ledger row, prices written and read as 0;
 * `refill.deliveryCost` stays reserved and off). The office assigns; only the assigned driver moves the
 * steps, by scans (RefillScanService) and the two "Leave" steps here; only the owner cancels, and only
 * before the first pickup. The store's receive scans finish a refill by themselves (refill-receive.ts), so
 * the Inc 1 count steps and the office's "Mark complete" are retired (410). Do-it-yourself refills are
 * retired too (410).
 */
@Injectable()
export class FillingOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * `POST /filling-orders` (DISTRIBUTOR exact, Idempotency-Key). The key is looked up first (§4.2), so a
   * retry gets the first refill (200 `Idempotent-Replay`) even if it would now be refused, and the same key
   * with another station, size or count is 409 IDEMPOTENCY_CONFLICT. Then the rules in order: an ACTIVE
   * distributor; DIY is 410 REFILL_DIY_RETIRED; at most `refill.maxCylinders` (400 REFILL_TOO_MANY); the
   * station exists and is active; the pickup is the home store (a body value is ignored). One transaction
   * numbers the refill from the distributor's own counter (`next_refill_no`: AG-R001, AG-R002…, no gap and
   * no duplicate under concurrent creates), stores the key and writes `refill.create`.
   */
  async create(actor: UserActor, body: CreateFillingOrderInput, key?: string): Promise<RefillView | IdempotentResponse<RefillView>> {
    const distributorId = ownDistributorId(actor);
    if (key) {
      const first = await this.replayOf(actor, distributorId, key, body);
      if (first) return first;
    }
    const distributor = await this.prisma.distributor.findUnique({
      where: { id: distributorId },
      select: { id: true, status: true, homeStoreId: true, businessName: true, code: true },
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

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const [{ no }] = await tx.$queryRaw<Array<{ no: number }>>`
          UPDATE distributors SET next_refill_no = next_refill_no + 1, updated_at = (now() AT TIME ZONE 'UTC')
          WHERE id = ${distributorId}::uuid
          RETURNING next_refill_no - 1 AS no`;
        const refillNo = Number(no);
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
            refillNo,
            clientRequestId: key ?? null,
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
            diff: {
              distributor: distributor.businessName,
              refill: refillShortCode(distributor.code, refillNo),
              count: body.requestedCount,
              size: sizeLabelOf(type),
            },
          },
          tx,
        );
        return refill.id;
      }, LOCKING_TX);
    } catch (error) {
      // A twin request with the same key committed first: answer as its retry.
      if (key && isUniqueViolation(error, CLIENT_REQUEST_KEY)) {
        const first = await this.replayOf(actor, distributorId, key, body);
        if (first) return first;
      }
      throw error;
    }
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

  /** `GET /filling-orders/:id` (`canSeeRefill`: the office, the owner, the assigned driver), with its picked cylinders. */
  async byId(caller: PolicyCaller, id: string): Promise<RefillView> {
    const row = await this.prisma.fillingOrder.findUnique({ where: { id }, include: REFILL_VIEW_INCLUDE });
    return toRefillView(canSeeRefill(caller, row), caller, { withCylinders: true });
  }

  /**
   * `PATCH /filling-orders/:id/assign` (office) `{ driverId }`, checked in order: an unknown refill
   * or driver is 404; PENDING (the same driver again: 200 `X-Already-Applied`), else 409
   * REFILL_WRONG_STEP; the driver ACTIVE and AVAILABLE; a van, saved as the refill's van (the pickups
   * go onto it). Audited `refill.assign`.
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
      const moved = await tx.fillingOrder.updateMany({
        where: { id, status: FillingOrderStatus.PENDING },
        data: { status: FillingOrderStatus.ASSIGNED, assignedDriverId: driver.id, assignedVehicleId: driver.currentVehicleId },
      });
      if (moved.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      await this.audit.record(
        {
          action: 'refill.assign',
          actor,
          resourceType: 'refill',
          resourceId: id,
          distributorId: refill.distributorId,
          diff: {
            distributor: refill.distributor.businessName,
            refill: refillShortCode(refill.distributor.code, refill.refillNo),
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
   * `POST /filling-orders/:id/advance` (the assigned driver; anyone else 404) `{ to }`:
   * - EMPTIES_PICKED is "Leave store": from ASSIGNED with at least one picked cylinder;
   * - FILLED is "Leave station": from AT_STATION (the first fill made it so).
   * The status the refill already has answers 200 `X-Already-Applied`; anything else is 409
   * REFILL_WRONG_STEP `{currentStatus}` and changes nothing. No money, and no audit row (Appendix B has
   * none for the driver's steps).
   */
  async advance(actor: UserActor, id: string, to: RefillAdvanceTarget): Promise<RefillView | IdempotentResponse<RefillView>> {
    const driverId = ownDriverId(actor);
    const target = FillingOrderStatus[to];
    const applied = await this.prisma.$transaction(async (tx) => {
      const refill = await this.lock(tx, id);
      if (refill.assignedDriverId !== driverId) throw new AppError('NOT_FOUND');
      if (refill.status === target) return false;
      const from = ADVANCE_FROM[to];
      const ready = refill.status === from && (to !== 'EMPTIES_PICKED' || (await tx.fillingOrderCylinder.count({ where: { fillingOrderId: id } })) > 0);
      if (!ready) throw new AppError('REFILL_WRONG_STEP', { currentStatus: refill.status });
      const moved = await tx.fillingOrder.updateMany({ where: { id, status: from }, data: { status: target } });
      if (moved.count !== 1) throw new AppError('REFILL_WRONG_STEP', { currentStatus: refill.status });
      return true;
    }, LOCKING_TX);
    const view = await this.view(actor, id);
    return applied ? view : alreadyApplied(view);
  }

  /**
   * The retired Inc 1 count steps (`PATCH /filling-orders/:id/picked-empties`, `/at-station`, `/filled`,
   * `/returned`): every refill step is a scan from Inc 3 (§10.1, Appendix A). The assigned driver gets 410
   * REFILL_USE_SCANS ("Update the app to continue.") and nothing changes; anyone else 404, as before.
   */
  async retiredStep(actor: UserActor, id: string): Promise<never> {
    const driverId = ownDriverId(actor);
    const refill = await this.prisma.fillingOrder.findUnique({ where: { id }, select: { assignedDriverId: true } });
    if (!refill || refill.assignedDriverId !== driverId) throw new AppError('NOT_FOUND');
    throw new AppError('REFILL_USE_SCANS');
  }

  /**
   * The retired office "Mark complete" (`PATCH /filling-orders/:id/complete`): from Inc 3 a refill finishes
   * by itself on the store's last receive scan, so this answers 410 REFILL_AUTO_COMPLETES and changes
   * nothing (an unknown refill stays 404).
   */
  async retiredComplete(id: string): Promise<never> {
    const refill = await this.prisma.fillingOrder.findUnique({ where: { id }, select: { id: true } });
    if (!refill) throw new AppError('NOT_FOUND');
    throw new AppError('REFILL_AUTO_COMPLETES');
  }

  /**
   * `PATCH /filling-orders/:id/cancel` (the owning distributor only; the office has no cancel) `{ reason }`:
   * only while PENDING, or ASSIGNED with nothing picked up (409 REFILL_NOT_CANCELLABLE). It locks the refill
   * row, as every pickup does, so of a cancel and a first pickup at the same moment exactly one wins. Sets
   * `cancelled_at` and `cancelled_by_user_id`. A repeat: 200 `X-Already-Applied`, no second audit row.
   * Audited `refill.cancel` with the reason. No money.
   */
  async cancel(actor: UserActor, id: string, reason: string): Promise<RefillView | IdempotentResponse<RefillView>> {
    const applied = await this.prisma.$transaction(async (tx) => {
      const refill = await this.lock(tx, id);
      if (refill.distributorId !== actor.distributorId) throw new AppError('NOT_FOUND');
      if (refill.status === FillingOrderStatus.CANCELLED) return false;
      const picked = await tx.fillingOrderCylinder.count({ where: { fillingOrderId: id } });
      if (!CANCELLABLE.includes(refill.status) || picked > 0) throw new AppError('REFILL_NOT_CANCELLABLE', { currentStatus: refill.status });
      const moved = await tx.fillingOrder.updateMany({
        where: { id, status: { in: CANCELLABLE }, pickedUpAt: null },
        data: { status: FillingOrderStatus.CANCELLED, cancellationReason: reason, cancelledAt: new Date(), cancelledByUserId: actor.userId },
      });
      if (moved.count !== 1) throw new AppError('REFILL_NOT_CANCELLABLE', { currentStatus: refill.status });
      await this.audit.record(
        {
          action: 'refill.cancel',
          actor,
          resourceType: 'refill',
          resourceId: id,
          distributorId: refill.distributorId,
          reason,
          diff: {
            distributor: refill.distributor.businessName,
            refill: refillShortCode(refill.distributor.code, refill.refillNo),
            count: refill.requestedCount,
            size: sizeLabelOf(refill.cylinderType),
          },
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

  /** One refill as the caller sees it, with its picked cylinders (the answer of every refill action). */
  async view(caller: PolicyCaller, id: string): Promise<RefillView> {
    const row = await this.prisma.fillingOrder.findUniqueOrThrow({ where: { id }, include: REFILL_VIEW_INCLUDE });
    return toRefillView(row, caller, { withCylinders: true });
  }

  // ---------- internals ----------

  /**
   * A create retried with a key already used by this distributor: the first refill (200
   * `Idempotent-Replay`) when the key fields match (§4.2: station, size, count), else 409
   * IDEMPOTENCY_CONFLICT. Null when the key is new.
   */
  private async replayOf(actor: UserActor, distributorId: string, key: string, body: CreateFillingOrderInput): Promise<IdempotentResponse<RefillView> | null> {
    const first = await this.prisma.fillingOrder.findUnique({
      where: { distributorId_clientRequestId: { distributorId, clientRequestId: key } },
      select: { id: true, fillingStationId: true, cylinderTypeId: true, requestedCount: true },
    });
    if (!first) return null;
    const lower = (value: string | null | undefined) => (typeof value === 'string' ? value.toLowerCase() : value);
    assertSameRequest(
      { fillingStationId: lower(first.fillingStationId), cylinderTypeId: lower(first.cylinderTypeId), requestedCount: first.requestedCount },
      { fillingStationId: lower(body.fillingStationId), cylinderTypeId: lower(body.cylinderTypeId), requestedCount: body.requestedCount },
      REFILL_IDEMPOTENCY_FIELDS,
    );
    return replayed(await this.view(actor, first.id));
  }

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
        assignedDriverId: true,
        refillNo: true,
        distributor: { select: { businessName: true, code: true } },
        cylinderType: { select: { name: true, weightKg: true } },
      },
    });
  }
}
