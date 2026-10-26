import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  createFillingStationSchema,
  locationQuoteQuerySchema,
  updateFillingStationSchema,
  type CreateFillingStationInput,
  type UpdateFillingStationInput,
} from '@smartfleet/shared-validation';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { FillingStationsService, type FillingStationView } from './filling-stations.service';

const nearbyQuerySchema = locationQuoteQuerySchema.pick({ lat: true, lng: true });

/** Refill stations (API_CONTRACT §7.2): GET for anyone signed in; writes office. The price reads 0. */
@Controller('filling-stations')
export class FillingStationsController {
  constructor(private readonly stations: FillingStationsService) {}

  @Get()
  list(@Query('includeInactive') includeInactive?: string): Promise<FillingStationView[]> {
    return this.stations.list(includeInactive === 'true');
  }

  @Get('nearby')
  nearby(@Query(new ZodQuery(nearbyQuerySchema)) point: { lat: number; lng: number }, @Query('radiusKm') radiusKm?: string) {
    const radius = Number(radiusKm ?? 10);
    return this.stations.nearby(point.lat, point.lng, Number.isFinite(radius) && radius > 0 ? Math.min(radius, 200) : 10);
  }

  @Get(':id')
  byId(@Param('id', new UuidParam()) id: string): Promise<FillingStationView> {
    return this.stations.byId(id);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post()
  create(@Body(new ZodBody(createFillingStationSchema)) body: CreateFillingStationInput): Promise<FillingStationView> {
    return this.stations.create(body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id')
  update(
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(updateFillingStationSchema)) body: UpdateFillingStationInput,
  ): Promise<FillingStationView> {
    return this.stations.update(id, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Delete(':id')
  archive(@Param('id', new UuidParam()) id: string) {
    return this.stations.archive(id);
  }
}
