import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get('city/:cityId')
  list(@Param('cityId') cityId: string) {
    return this.zones.listForCity(cityId);
  }

  @Get('locate')
  locate(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.zones.findContainingPoint(Number(lat), Number(lng));
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: any) {
    return this.zones.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.zones.update(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.zones.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.zones.reactivate(id);
  }
}
