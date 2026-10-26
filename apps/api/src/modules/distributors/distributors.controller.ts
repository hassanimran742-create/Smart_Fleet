import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { DistributorDto, DistributorHomeDto } from '@smartfleet/shared-types';
import {
  approveDistributorSchema,
  changeDistributorCodeSchema,
  createDistributorSchema,
  suspendDistributorSchema,
  updateDistributorSchema,
  updateDistributorStoreSchema,
  type ApproveDistributorInput,
  type ChangeDistributorCodeInput,
  type CreateDistributorInput,
  type SuspendDistributorInput,
  type UpdateDistributorInput,
  type UpdateDistributorStoreInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { IdempotencyKey } from '../../common/idempotency/idempotency';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { DistributorsService } from './distributors.service';

/** Distributors and their one store (API_CONTRACT §7.3): office routes, plus the shop's own `me`. */
@Controller('distributors')
export class DistributorsController {
  constructor(private readonly distributors: DistributorsService) {}

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get()
  list(): Promise<DistributorDto[]> {
    return this.distributors.list();
  }

  /** The shop's own record, without readiness or the masked CNIC. */
  @ExactRoles(UserRole.DISTRIBUTOR)
  @Get('me')
  me(@CurrentActor() actor: UserActor): Promise<DistributorDto> {
    return this.distributors.byId(ownDistributorId(actor), 'SELF');
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get(':id')
  byId(@Param('id', new UuidParam()) id: string): Promise<DistributorDto> {
    return this.distributors.byId(id, 'OFFICE');
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post()
  create(
    @CurrentActor() actor: UserActor,
    @IdempotencyKey() key: string | undefined,
    @Body(new ZodBody(createDistributorSchema)) body: CreateDistributorInput,
  ) {
    return this.distributors.create(actor, body, key);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/store')
  updateStore(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(updateDistributorStoreSchema)) body: UpdateDistributorStoreInput,
  ): Promise<DistributorDto> {
    return this.distributors.updateStore(actor, id, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/code')
  changeCode(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(changeDistributorCodeSchema)) body: ChangeDistributorCodeInput,
  ): Promise<DistributorDto> {
    return this.distributors.changeCode(actor, id, body.code);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/approve')
  approve(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(approveDistributorSchema)) body: ApproveDistributorInput,
  ) {
    return this.distributors.approve(actor, id, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/suspend')
  suspend(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(suspendDistributorSchema)) body: SuspendDistributorInput,
  ) {
    return this.distributors.suspend(actor, id, body.reason);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id')
  update(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(updateDistributorSchema)) body: UpdateDistributorInput,
  ): Promise<DistributorDto> {
    return this.distributors.update(actor, id, body);
  }
}

/** `GET /distributor/home` (DISTRIBUTOR exact): the shop's home screen in one round trip. */
@Controller('distributor')
export class DistributorHomeController {
  constructor(private readonly distributors: DistributorsService) {}

  @ExactRoles(UserRole.DISTRIBUTOR)
  @Get('home')
  home(@CurrentActor() actor: UserActor): Promise<DistributorHomeDto> {
    return this.distributors.home(ownDistributorId(actor));
  }
}
