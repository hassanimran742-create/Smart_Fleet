import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { IdName } from '@smartfleet/shared-types';
import {
  createZoneSchema,
  locationQuoteQuerySchema,
  updateZoneSchema,
  zonesQuerySchema,
  type CreateZoneInput,
  type UpdateZoneInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor, CurrentUser, type AuthContext } from '../../common/decorators/current-user.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { ZoneBody } from './zone-body.pipe';
import { ZonesService, type ZoneListRow } from './zones.service';

const locateQuerySchema = locationQuoteQuerySchema.pick({ lat: true, lng: true }).merge(zonesQuerySchema);
type LocateQuery = { lat: number; lng: number; includeArchived?: boolean };
type ZonesQuery = { includeArchived?: boolean };

/**
 * Zones (API_CONTRACT §7.2): the office and distributors read; only the office changes them. The
 * office may include archived zones; a distributor's `includeArchived` is ignored.
 */
@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Roles(UserRole.DISTRIBUTOR)
  @Get('city/:cityId')
  list(
    @CurrentUser() user: AuthContext,
    @Param('cityId', new UuidParam()) cityId: string,
    @Query(new ZodQuery(zonesQuerySchema)) query: ZonesQuery,
  ): Promise<ZoneListRow[]> {
    return this.zones.listForCity(cityId, user.role === UserRole.SUPER_ADMIN && query.includeArchived === true);
  }

  /** The zone covering a pin, or an empty answer outside every active zone. */
  @Roles(UserRole.DISTRIBUTOR)
  @Get('locate')
  locate(@CurrentUser() user: AuthContext, @Query(new ZodQuery(locateQuerySchema)) query: LocateQuery): Promise<IdName | null> {
    const includeArchived = user.role === UserRole.SUPER_ADMIN && query.includeArchived === true;
    return this.zones.findContainingPoint(query.lat, query.lng, undefined, { includeArchived });
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post()
  create(@CurrentActor() actor: UserActor, @Body(new ZoneBody(createZoneSchema)) body: CreateZoneInput) {
    return this.zones.create(actor, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id')
  update(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZoneBody(updateZoneSchema)) body: UpdateZoneInput,
  ) {
    return this.zones.update(actor, id, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Delete(':id')
  archive(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.zones.archive(actor, id);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/reactivate')
  reactivate(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.zones.reactivate(actor, id);
  }
}
