import { Injectable } from '@nestjs/common';
import {
  CustodyType,
  CylinderEventSource,
  CylinderEventType,
  CylinderState,
  FillingOrderCylinderStatus,
  FillingOrderStatus,
  Prisma,
  type CylinderEvent,
  type FillingOrderCylinder,
} from '@prisma/client';
import type { ErrorCode, RefillScanPhase, RefillScanResult, ScanAction } from '@smartfleet/shared-types';
import type { UserActor } from '../../common/auth/actor';
import { ownDriverId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { lockCylinderForMove, openRefillLineCylinderIds, recordCustodyMove, type LockedCylinderRow } from '../custody/custody-moves';
import { cylinderShortCode, resolveScanCode, type EntryMethod } from '../custody/cylinder-codes';
import { scannedCylinder } from '../custody/holders';
import type { ScanAnswer, ScanAnswerKind } from '../custody/scan.service';
import { LOCKING_TX, type Tx } from '../orders/support/tx';
import { sizeLabelOf } from '../pricing/size-label';
import { SettingsService } from '../settings/settings.service';
import { refillProgressOf } from './refill.mapper';

/** `POST /filling-orders/:id/scans` once the body is checked (API_CONTRACT §10.1). */
export interface RefillScanCommand {
  scanId: string;
  phase: RefillScanPhase;
  code: string;
  entryMethod: EntryMethod;
  lat?: number;
  lng?: number;
}

/** The refill row a scan works on (read for its context, then locked before the move). */
const CONTEXT_SELECT = {
  id: true,
  distributorId: true,
  status: true,
  requestedCount: true,
  cylinderTypeId: true,
  assignedDriverId: true,
  assignedVehicleId: true,
  distributor: { select: { id: true, code: true, homeStoreId: true, homeStore: { select: { name: true } } } },
  cylinderType: { select: { name: true, weightKg: true } },
} satisfies Prisma.FillingOrderSelect;

type RefillContext = Prisma.FillingOrderGetPayload<{ select: typeof CONTEXT_SELECT }>;

const BLOCKED: CylinderState[] = [CylinderState.FAULTY, CylinderState.LOST];
const PICKUP_STATES: CylinderState[] = [CylinderState.EMPTY, CylinderState.PART_FILLED];
const SCAN_ID_KEY = 'cylinder_events_actor_user_id_client_scan_id_key';

/** The refill steps each scan phase is allowed in (§10.1): a PICKUP before "Leave store", a FILL at the station. */
const PHASE_STEPS: Record<RefillScanPhase, FillingOrderStatus[]> = {
  PICKUP: [FillingOrderStatus.ASSIGNED],
  FILL: [FillingOrderStatus.EMPTIES_PICKED, FillingOrderStatus.AT_STATION],
};

const ACTION_OF: Record<RefillScanPhase, ScanAction> = { PICKUP: 'REFILL_PICKUP', FILL: 'REFILL_FILL' };

/** The scan phase a recorded refill move stands for: PICKUP (SCAN_OUT) or FILL (FILLED), on a refill. */
export function refillPhaseOfEvent(event: Pick<CylinderEvent, 'eventType' | 'fillingOrderId' | 'tripId'>): RefillScanPhase | null {
  if (!event.fillingOrderId) return null;
  if (event.eventType === CylinderEventType.SCAN_OUT && !event.tripId) return 'PICKUP';
  if (event.eventType === CylinderEventType.FILLED) return 'FILL';
  return null;
}

/**
 * The refill run's two driver scans (API_CONTRACT §10.1, §9.2), each one move written through the custody
 * module's own move write (`recordCustodyMove`), in one transaction:
 *
 * - **PICKUP** (ASSIGNED): STORE (the home store) → VEHICLE (the refill's van), the state unchanged, event
 *   SCAN_OUT with `filling_order_id` and no trip, and a PICKED_UP line. The refill's driver becomes the
 *   responsible driver. It never stamps `load_started_at`: a refill pickup is no load scan of any trip.
 * - **FILL** (EMPTIES_PICKED or AT_STATION; the first one sets AT_STATION): event FILLED, VEHICLE →
 *   VEHICLE, the state unchanged until the store receives it (no filling-station holder, ADR-13), and the
 *   line's `filled_at`.
 *
 * The checks run in the §9.2 order: the assigned driver (404), a resend, the step, typing, the code, the
 * cylinder lock, the owner, the same move again, damaged or lost, then the phase's own rules. Rows are locked
 * cylinder first, then the refill, the order the store's receive takes them in, so a fill and a receive of
 * one cylinder can't deadlock; the refill lock serialises pickups against each other and against a cancel.
 * No money, ever.
 */
@Injectable()
export class RefillScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
  ) {}

  /** A twin request with the same scan id that commits first is answered as its replay. */
  async scan(actor: UserActor, refillId: string, cmd: RefillScanCommand): Promise<ScanAnswer<RefillScanResult>> {
    const driverId = ownDriverId(actor);
    const run = () => this.prisma.$transaction((tx) => this.scanTx(tx, actor, driverId, refillId, cmd), LOCKING_TX);
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error, SCAN_ID_KEY)) return run();
      throw error;
    }
  }

  private async scanTx(tx: Tx, actor: UserActor, driverId: string, refillId: string, cmd: RefillScanCommand): Promise<ScanAnswer<RefillScanResult>> {
    // 1. Context and ownership: the refill's assigned driver only (anyone else: 404, as for an unknown id).
    const refill = await this.context(tx, refillId);
    if (!refill || refill.assignedDriverId !== driverId) throw new AppError('NOT_FOUND');

    // 2. A resend with the same scan id returns the recorded scan, whatever the rules say now.
    const resend = await this.resend(tx, actor, cmd, refill);
    if (resend) return resend;

    // 3. The phase must fit the refill's step.
    if (!PHASE_STEPS[cmd.phase].includes(refill.status)) {
      throw await this.refusal(tx, refill.id, 'REFILL_WRONG_STEP', { currentStatus: refill.status });
    }

    // 4. A typed number while typing is switched off, before any lookup.
    if (cmd.entryMethod === 'TYPED' && !(await this.settings.get('custody.typedEntry.enabled'))) throw new AppError('FEATURE_DISABLED');

    // 5. Resolve the code: QR exactly, whoever owns it; a typed number within the refill's distributor.
    const cylinderId = await resolveScanCode(tx, {
      code: cmd.code,
      entryMethod: cmd.entryMethod,
      distributor: { id: refill.distributorId, code: refill.distributor.code },
    });
    if (!cylinderId) throw await this.refusal(tx, refill.id, 'SCAN_CYLINDER_UNKNOWN');

    // 6. Lock the cylinder, then the refill. A twin with the same scan id may have committed meanwhile, and
    //    a cancel or another pickup may have changed the refill: both are read again under the locks.
    const cylinder = await lockCylinderForMove(tx, cylinderId);
    const twin = await this.resend(tx, actor, cmd, refill);
    if (twin) return twin;
    const locked = await this.lockRefill(tx, refill.id);
    if (locked.assignedDriverId !== driverId) throw new AppError('NOT_FOUND');
    if (!PHASE_STEPS[cmd.phase].includes(locked.status)) {
      throw await this.refusal(tx, refill.id, 'REFILL_WRONG_STEP', { currentStatus: locked.status });
    }

    // 7. Owner: the refill's distributor.
    if (cylinder.distributor_id !== locked.distributorId) throw await this.refusal(tx, refill.id, 'SCAN_WRONG_OWNER');

    // 8. The same move again under a new scan id: answered, nothing written, the counts unchanged.
    const line = await tx.fillingOrderCylinder.findUnique({
      where: { fillingOrderId_cylinderId: { fillingOrderId: refill.id, cylinderId: cylinder.id } },
    });
    const repeat = await this.sameMove(tx, cmd.phase, refill.id, cylinder.id, line);
    if (repeat) return this.answer(tx, 'ALREADY', refill.id, cylinder.id, repeat.event, cmd.phase);

    // 9. Damaged or lost: never picked up.
    if (cmd.phase === 'PICKUP' && BLOCKED.includes(cylinder.state)) throw await this.refusal(tx, refill.id, 'SCAN_CYLINDER_BLOCKED');

    // 10 and 11. The phase's own rules, then the move.
    const source = cmd.entryMethod === 'TYPED' ? CylinderEventSource.TYPED : CylinderEventSource.SCAN;
    const event =
      cmd.phase === 'PICKUP'
        ? await this.pickUp(tx, actor, cmd, locked, cylinder, line, source)
        : await this.fill(tx, actor, cmd, locked, cylinder, line, source);
    if (cmd.entryMethod === 'TYPED') await this.auditTyped(tx, actor, cylinder, locked, cmd, event.id);
    return this.answer(tx, 'RECORDED', refill.id, cylinder.id, event, cmd.phase);
  }

  /**
   * PICKUP's rules, in order (§10.1, G08-05): not on another open refill (a PICKED_UP or FILLED line of a
   * refill that isn't COMPLETED or CANCELLED; a RETURNED line never blocks); in the home store; the
   * refill's size; EMPTY or PART_FILLED; picked lines below requested. Then the move and its line.
   */
  private async pickUp(
    tx: Tx,
    actor: UserActor,
    cmd: RefillScanCommand,
    refill: RefillContext,
    cylinder: LockedCylinderRow,
    line: FillingOrderCylinder | null,
    source: CylinderEventSource,
  ): Promise<CylinderEvent> {
    const open = (await openRefillLineCylinderIds(tx, { cylinderIds: [cylinder.id] })).get(cylinder.id);
    if (open && open.fillingOrderId !== refill.id) throw await this.refusal(tx, refill.id, 'REFILL_CYLINDER_ON_OTHER_REFILL');
    if (cylinder.custody_type !== CustodyType.STORE || cylinder.custody_id !== refill.distributor.homeStoreId) {
      throw await this.refusal(tx, refill.id, 'SCAN_NOT_AT_STORE', { store: refill.distributor.homeStore.name });
    }
    if (cylinder.cylinder_type_id !== refill.cylinderTypeId) {
      throw await this.refusal(tx, refill.id, 'REFILL_CYLINDER_WRONG_SIZE', { sizeLabel: sizeLabelOf(refill.cylinderType) });
    }
    if (!PICKUP_STATES.includes(cylinder.state)) throw await this.refusal(tx, refill.id, 'REFILL_CYLINDER_NOT_EMPTY');
    // A line already RETURNED to the store (this same cylinder picked up again) is counted once.
    const picked = await tx.fillingOrderCylinder.count({ where: { fillingOrderId: refill.id, ...(line ? { id: { not: line.id } } : {}) } });
    if (picked >= refill.requestedCount) throw await this.refusal(tx, refill.id, 'REFILL_COUNT_REACHED', { requested: refill.requestedCount });
    if (!refill.assignedVehicleId) throw await this.refusal(tx, refill.id, 'REFILL_WRONG_STEP', { currentStatus: refill.status });

    const event = await recordCustodyMove(tx, {
      cylinder,
      eventType: CylinderEventType.SCAN_OUT,
      to: { type: CustodyType.VEHICLE, id: refill.assignedVehicleId },
      toState: cylinder.state,
      source,
      actorUserId: actor.userId,
      clientScanId: cmd.scanId,
      fillingOrderId: refill.id,
      lat: cmd.lat,
      lng: cmd.lng,
    });
    const step = {
      status: FillingOrderCylinderStatus.PICKED_UP,
      stateAtPickup: cylinder.state,
      pickedUpAt: event.createdAt,
      filledAt: null,
      returnedAt: null,
    };
    if (line) await tx.fillingOrderCylinder.update({ where: { id: line.id }, data: step });
    else await tx.fillingOrderCylinder.create({ data: { fillingOrderId: refill.id, cylinderId: cylinder.id, ...step } });
    // The first pickup: from now on the owner can't cancel.
    await tx.fillingOrder.updateMany({ where: { id: refill.id, pickedUpAt: null }, data: { pickedUpAt: event.createdAt } });
    return event;
  }

  /**
   * FILL's rule (§10.1): a PICKED_UP line of this refill whose cylinder is still on the refill's van, else
   * REFILL_CYLINDER_NOT_ON_THIS_REFILL. The move keeps the holder and the state (it becomes FULL only when
   * the store receives it); the first fill makes the refill AT_STATION.
   */
  private async fill(
    tx: Tx,
    actor: UserActor,
    cmd: RefillScanCommand,
    refill: RefillContext,
    cylinder: LockedCylinderRow,
    line: FillingOrderCylinder | null,
    source: CylinderEventSource,
  ): Promise<CylinderEvent> {
    const onVan = cylinder.custody_type === CustodyType.VEHICLE && cylinder.custody_id === refill.assignedVehicleId;
    if (!line || line.status !== FillingOrderCylinderStatus.PICKED_UP || !onVan) {
      throw await this.refusal(tx, refill.id, 'REFILL_CYLINDER_NOT_ON_THIS_REFILL');
    }
    const event = await recordCustodyMove(tx, {
      cylinder,
      eventType: CylinderEventType.FILLED,
      to: { type: cylinder.custody_type, id: cylinder.custody_id },
      toState: cylinder.state,
      source,
      actorUserId: actor.userId,
      clientScanId: cmd.scanId,
      fillingOrderId: refill.id,
      lat: cmd.lat,
      lng: cmd.lng,
    });
    await tx.fillingOrderCylinder.update({ where: { id: line.id }, data: { status: FillingOrderCylinderStatus.FILLED, filledAt: event.createdAt } });
    await tx.fillingOrder.updateMany({
      where: { id: refill.id, status: FillingOrderStatus.EMPTIES_PICKED },
      data: { status: FillingOrderStatus.AT_STATION },
    });
    return event;
  }

  /**
   * §9.2 step 8: a PICKUP of a cylinder with an open line on this refill, or a FILL of a line that already
   * has `filled_at`, is the same move again. Returns the move it repeats (`event` null only for a line
   * written without its move), or null when it isn't a repeat.
   */
  private async sameMove(
    tx: Tx,
    phase: RefillScanPhase,
    refillId: string,
    cylinderId: string,
    line: FillingOrderCylinder | null,
  ): Promise<{ event: CylinderEvent | null } | null> {
    if (!line) return null;
    if (phase === 'PICKUP' && line.status === FillingOrderCylinderStatus.RETURNED) return null;
    if (phase === 'FILL' && line.filledAt === null) return null;
    const event = await tx.cylinderEvent.findFirst({
      where: {
        cylinderId,
        fillingOrderId: refillId,
        eventType: phase === 'PICKUP' ? CylinderEventType.SCAN_OUT : CylinderEventType.FILLED,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return { event };
  }

  /**
   * §9.2 step 2: the recorded scan for a resend, or 409 SCAN_ID_REUSED when the same scan id was used for
   * another cylinder, another phase, another refill or a trip scan.
   */
  private async resend(tx: Tx, actor: UserActor, cmd: RefillScanCommand, refill: RefillContext): Promise<ScanAnswer<RefillScanResult> | null> {
    const prior = await tx.cylinderEvent.findUnique({ where: { actorUserId_clientScanId: { actorUserId: actor.userId, clientScanId: cmd.scanId } } });
    if (!prior) return null;
    const named = await resolveScanCode(tx, {
      code: cmd.code,
      entryMethod: cmd.entryMethod,
      distributor: { id: refill.distributorId, code: refill.distributor.code },
    });
    if (named !== prior.cylinderId || prior.fillingOrderId !== refill.id || refillPhaseOfEvent(prior) !== cmd.phase) {
      throw await this.refusal(tx, refill.id, 'SCAN_ID_REUSED');
    }
    return this.answer(tx, 'REPLAY', refill.id, prior.cylinderId, prior, cmd.phase);
  }

  /** The scan answer (§10.1): the `ScanResult` with no stop, plus the refill's counts as they are now. */
  private async answer(
    tx: Tx,
    kind: ScanAnswerKind,
    refillId: string,
    cylinderId: string,
    event: CylinderEvent | null,
    phase: RefillScanPhase,
  ): Promise<ScanAnswer<RefillScanResult>> {
    const [cylinder, progress] = await Promise.all([scannedCylinder(tx, cylinderId), this.progress(tx, refillId)]);
    return {
      kind,
      event,
      result: {
        result: kind === 'RECORDED' ? 'RECORDED' : 'ALREADY_RECORDED',
        scan: { scanId: event?.clientScanId ?? null, action: ACTION_OF[phase], at: (event?.createdAt ?? new Date()).toISOString() },
        cylinder,
        stop: null,
        refill: {
          status: progress.status,
          picked: progress.picked,
          filled: progress.filled,
          received: progress.received,
          requested: progress.requested,
        },
      },
    };
  }

  /** A refusal with the refill's counts as its progress (§9.3, §10.1: the screen still shows "1 of 2"). */
  private async refusal(tx: Tx, refillId: string, code: ErrorCode, details: Record<string, unknown> = {}): Promise<AppError> {
    const progress = await this.progress(tx, refillId);
    return new (AppError as unknown as new (code: ErrorCode, details: Record<string, unknown>) => AppError)(code, { ...details, progress });
  }

  private async progress(tx: Tx, refillId: string) {
    const row = await tx.fillingOrder.findUniqueOrThrow({
      where: { id: refillId },
      select: {
        status: true,
        requestedCount: true,
        pickedUpEmptyCount: true,
        filledCount: true,
        cylinders: { select: { status: true, filledAt: true } },
      },
    });
    return refillProgressOf(row);
  }

  private context(tx: Tx, refillId: string): Promise<RefillContext | null> {
    return tx.fillingOrder.findUnique({ where: { id: refillId }, select: CONTEXT_SELECT });
  }

  private async lockRefill(tx: Tx, refillId: string): Promise<RefillContext> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM filling_orders WHERE id = ${refillId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return tx.fillingOrder.findUniqueOrThrow({ where: { id: refillId }, select: CONTEXT_SELECT });
  }

  /** A typed number writes `custody.typed_entry` (Appendix B) with the move; refusals and repeats write none. */
  private async auditTyped(tx: Tx, actor: UserActor, cylinder: LockedCylinderRow, refill: RefillContext, cmd: RefillScanCommand, eventId: string): Promise<void> {
    await this.audit.record(
      {
        action: 'custody.typed_entry',
        actor,
        resourceType: 'cylinder',
        resourceId: cylinder.id,
        distributorId: cylinder.distributor_id,
        diff: {
          typed: cmd.code,
          shortCode: cylinderShortCode(refill.distributor.code, cylinder.short_no),
          action: ACTION_OF[cmd.phase],
          eventId,
          fillingOrderId: refill.id,
        },
      },
      tx,
    );
  }
}
