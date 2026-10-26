import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  storeInputSchema,
  updateDistributorStoreSchema,
  type StoreInput,
  type UpdateDistributorStoreInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { StoresService, type StoreListRow } from './stores.service';

/** Stores (API_CONTRACT §7.2): office only. */
@Controller('stores')
@ExactRoles(UserRole.SUPER_ADMIN)
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  list(): Promise<StoreListRow[]> {
    return this.stores.list();
  }

  @Post()
  create(@Body(new ZodBody(storeInputSchema)) body: StoreInput) {
    return this.stores.create(body);
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(updateDistributorStoreSchema)) body: UpdateDistributorStoreInput,
  ) {
    return this.stores.update(actor, id, body);
  }

  @Delete(':id')
  archive(@Param('id', new UuidParam()) id: string) {
    return this.stores.archive(id);
  }

  @Patch(':id/reactivate')
  reactivate(@Param('id', new UuidParam()) id: string) {
    return this.stores.reactivate(id);
  }
}
