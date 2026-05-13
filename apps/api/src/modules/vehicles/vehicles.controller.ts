import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, VehicleStatus } from '@prisma/client';

@Controller('vehicles')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
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
  create(@Body() body: any) {
    return this.vehicles.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.vehicles.update(id, body);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: VehicleStatus) {
    return this.vehicles.setStatus(id, status);
  }

  @Patch(':id/zone')
  zone(@Param('id') id: string, @Body('homeZoneId') homeZoneId: string) {
    return this.vehicles.reassignZone(id, homeZoneId);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.vehicles.archive(id);
  }
}
