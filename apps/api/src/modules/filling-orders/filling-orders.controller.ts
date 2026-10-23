import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { FillingOrderStatus, UserRole, type Prisma } from '@prisma/client';
import {
  assignDriverSchema,
  cancelFillingOrderSchema,
  createFillingOrderSchema,
  refillFilledSchema,
  refillPickedEmptiesSchema,
  type AssignDriverInput,
  type CancelFillingOrderInput,
  type CreateFillingOrderInput,
  type RefillFilledInput,
  type RefillPickedEmptiesInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId, ownDriverId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { FillingOrdersService } from './filling-orders.service';
import type { RefillView } from './refill.mapper';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refills (API_CONTRACT §7.11): exact roles throughout. The distributor requests and cancels its own,
 * the office assigns and completes, and only the assigned driver moves the steps.
 */
@Controller('filling-orders')
export class FillingOrdersController {
  constructor(private readonly refills: FillingOrdersService) {}

  @ExactRoles(UserRole.DISTRIBUTOR)
  @Post()
  create(@CurrentActor() actor: UserActor, @Body(new ZodBody(createFillingOrderSchema)) body: CreateFillingOrderInput): Promise<RefillView> {
    return this.refills.create(actor, body);
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

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/picked-empties')
  pickedEmpties(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(refillPickedEmptiesSchema)) body: RefillPickedEmptiesInput,
  ) {
    return this.refills.step(actor, id, 'picked-empties', body.emptyCount);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/at-station')
  atStation(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.refills.step(actor, id, 'at-station');
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/filled')
  filled(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string, @Body(new ZodBody(refillFilledSchema)) body: RefillFilledInput) {
    return this.refills.step(actor, id, 'filled', body.filledCount);
  }

  @ExactRoles(UserRole.DRIVER)
  @Patch(':id/returned')
  returned(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.refills.step(actor, id, 'returned');
  }

  /** The office's "Mark complete": no money. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/complete')
  complete(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.refills.complete(actor, actor, id);
  }

  /** The owning distributor only, before pickup. The office has no cancel. */
  @ExactRoles(UserRole.DISTRIBUTOR)
  @Patch(':id/cancel')
  cancel(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string, @Body(new ZodBody(cancelFillingOrderSchema)) body: CancelFillingOrderInput) {
    return this.refills.cancel(actor, id, body.reason);
  }
}
