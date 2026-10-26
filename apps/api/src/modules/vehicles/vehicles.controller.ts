import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  createVehicleSchema,
  updateVehicleSchema,
  vehicleStatusSchema,
  vehicleZoneSchema,
  type CreateVehicleInput,
  type UpdateVehicleInput,
  type VehicleStatusInput,
  type VehicleZoneInput,
} from '@smartfleet/shared-validation';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { VehiclesService } from './vehicles.service';

/** Vans: office only (API_CONTRACT §7.2). */
@Controller('vehicles')
@ExactRoles(UserRole.SUPER_ADMIN)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list() {
    return this.vehicles.list();
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.vehicles.byId(id);
  }

  @Post()
  create(@Body(new ZodBody(createVehicleSchema)) body: CreateVehicleInput) {
    return this.vehicles.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodBody(updateVehicleSchema)) body: UpdateVehicleInput) {
    return this.vehicles.update(id, body);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body(new ZodBody(vehicleStatusSchema)) body: VehicleStatusInput) {
    return this.vehicles.setStatus(id, body.status);
  }

  @Patch(':id/zone')
  zone(@Param('id') id: string, @Body(new ZodBody(vehicleZoneSchema)) body: VehicleZoneInput) {
    return this.vehicles.reassignZone(id, body.homeZoneId);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.vehicles.archive(id);
  }
}
