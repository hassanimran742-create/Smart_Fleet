import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { FillingOrderStatus, UserRole, type Prisma } from '@prisma/client';
import {
  assignDriverSchema,
  cancelFillingOrderSchema,
  createFillingOrderSchema,
  refillAdvanceSchema,
  refillScanSchema,
  type AssignDriverInput,
  type CancelFillingOrderInput,
  type CreateFillingOrderInput,
  type RefillAdvanceInput,
  type RefillScanInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId, ownDriverId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { IdempotencyKey } from '../../common/idempotency/idempotency';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { scanResponse } from '../custody/scan.service';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { FillingOrdersService } from './filling-orders.service';
import { RefillScanService } from './refill-scans.service';
import type { RefillView } from './refill.mapper';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refills (API_CONTRACT §7.11, §10.1): exact roles throughout. The distributor requests and cancels its own,
 * the office assigns, and only the assigned driver moves the steps: by PICKUP and FILL scans and the two
 * "Leave" steps. The store's receive scans (`POST /store/scans`) bring the cylinders back and finish the
 * refill by themselves. No route here moves money.
 */
@Controller('filling-orders')
export class FillingOrdersController {
  constructor(
    private readonly refills: FillingOrdersService,
    private readonly scans: RefillScanService,
  ) {}

  /** 201 with the new refill (AG-R007); a retry with the same Idempotency-Key 200 `Idempotent-Replay`. */
  @ExactRoles(UserRole.DISTRIBUTOR)
  @Post()
  create(
    @CurrentActor() actor: UserActor,
    @IdempotencyKey() key: string | undefined,
    @Body(new ZodBody(createFillingOrderSchema)) body: CreateFillingOrderInput,
  ) {
    return this.refills.create(actor, body, key);
  }

  /** The office list, optionally by status or driver. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get()
  listAll(@CurrentActor() actor: UserActor, @Query('status') status?: string, @Query('driverId') driverId?: string): Promise<RefillView[]> {
    const where: Prisma.FillingOrderWhereInput = {};
    if (status && (Object.values(FillingOrderStatus) as string[]).includes(status)) where.status = status as FillingOrderStatus;
    if (driverId && UUID.test(driverId)) where.assignedDriverId = driverId;
    return this.refills.list(actor, where);
  }

  @ExactRoles(UserRole.DISTRIBUTOR)
  @Get('mine')
  mine(@CurrentActor() actor: UserActor): Promise<RefillView[]> {
    return this.refills.list(actor, { distributorId: ownDistributorId(actor) });
  }

  @ExactRoles(UserRole.DRIVER)
  @Get('driver/mine')
  driverMine(@CurrentActor() actor: UserActor): Promise<RefillView[]> {
    return this.refills.list(actor, { assignedDriverId: ownDriverId(actor) });
  }

  @ExactRoles(UserRole.DISTRIBUTOR, UserRole.DRIVER, UserRole.SUPER_ADMIN)
  @Get(':id')
  byId(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string): Promise<RefillView> {
    return this.refills.byId(actor, id);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get(':id/batch-candidates')
  batchCandidates(@Param('id', new UuidParam()) id: string, @Query('radiusKm') radiusKm?: string) {
    const radius = Number(radiusKm);
    return this.refills.batchCandidates(id, Number.isFinite(radius) && radius > 0 ? Math.min(radius, 100) : 5);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/assign')
  assign(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string, @Body(new ZodBody(assignDriverSchema)) body: AssignDriverInput) {
    return this.refills.assign(actor, actor, id, body.driverId);
  }

  // ---------- Inc 3: the refill run on scans (API_CONTRACT §10.1) ----------

  /**
   * PICKUP or FILL (the assigned driver): 201 RECORDED; a resend 200 `Idempotent-Replay`; the same move
   * again 200 `X-Already-Applied`. `toCustodyType` and `toCustodyId` are refused (400).
   */
  @ExactRoles(UserRole.DRIVER)
  @Post(':id/scans')
  async scan(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string, @Body(new ZodBody(refillScanSchema)) body: RefillScanInput) {
    return scanResponse(
      await this.scans.scan(actor, id, {
        scanId: body.scanId.toLowerCase(),
        phase: body.phase,
        code: body.code,
        entryMethod: body.entryMethod,
        lat: body.lat,
        lng: body.lng,
      }),
    );
  }

  /** "Leave store" (EMPTIES_PICKED) or "Leave station" (FILLED), the assigned driver: 200; the same again 200 `X-Already-Applied`. */
  @ExactRoles(UserRole.DRIVER)
  @Post(':id/advance')
  @HttpCode(200)
  advance(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string, @Body(new ZodBody(refillAdvanceSchema)) body: RefillAdvanceInput) {
    return this.refills.advance(actor, id, body.to);
  }

  // ---------- retired from Inc 3 (§10.1 "Retired", Appendix A) ----------

  /** The Inc 1 count steps: 410 REFILL_USE_SCANS for the assigned driver (the body is ignored). */
  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/picked-empties')
  pickedEmpties(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.refills.retiredStep(actor, id);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/at-station')
  atStation(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.refills.retiredStep(actor, id);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/filled')
  filled(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.refills.retiredStep(actor, id);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/returned')
  returned(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.refills.retiredStep(actor, id);
  }

  /** The office's Inc 1 "Mark complete": 410 REFILL_AUTO_COMPLETES (the last receive scan completes a refill). */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/complete')
  complete(@Param('id', new UuidParam()) id: string) {
    return this.refills.retiredComplete(id);
  }

  /** The owning distributor only, before the first pickup. The office has no cancel. */
  @ExactRoles(UserRole.DISTRIBUTOR)
  @Patch(':id/cancel')
  cancel(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string, @Body(new ZodBody(cancelFillingOrderSchema)) body: CancelFillingOrderInput) {
    return this.refills.cancel(actor, id, body.reason);
  }
}
