import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Get()
  list() {
    return this.drivers.list();
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.drivers.findById(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Post()
  create(@Body() body: any) {
    return this.drivers.create(body);
  }

  @Patch(':id/location')
  @Roles(UserRole.DRIVER)
  updateLocation(@Param('id') id: string, @Body() body: { lat: number; lng: number }) {
    return this.drivers.updateLocation(id, body.lat, body.lng);
  }

  @Patch(':id/online')
  @Roles(UserRole.DRIVER)
  setOnline(@Param('id') id: string, @Body() body: { isOnline: boolean }) {
    return this.drivers.setOnline(id, body.isOnline);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/vehicle')
  assign(@Param('id') id: string, @Body() body: { vehicleId: string | null }) {
    return this.drivers.assignVehicle(id, body.vehicleId);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  @Patch(':id/profile')
  updateProfile(@Param('id') id: string, @Body() body: any) {
    return this.drivers.updateProfile(id, body);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Patch(':id/availability')
  setAvailability(
    @Param('id') id: string,
    @Body() body: { availability: 'AVAILABLE' | 'ON_LEAVE' | 'OFF_DUTY'; leaveStart?: string; leaveEnd?: string; reason?: string },
  ) {
    return this.drivers.setAvailability(id, body.availability as any, body.leaveStart, body.leaveEnd, body.reason);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.drivers.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.drivers.reactivate(id);
  }
}
