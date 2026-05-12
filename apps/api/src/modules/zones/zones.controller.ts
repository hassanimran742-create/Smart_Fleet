import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
}
