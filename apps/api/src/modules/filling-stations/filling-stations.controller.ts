import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { FillingStationsService } from './filling-stations.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('filling-stations')
export class FillingStationsController {
  constructor(private readonly stations: FillingStationsService) {}

  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.stations.list(includeInactive === 'true');
  }

  @Get('nearby')
  nearby(@Query('lat') lat: string, @Query('lng') lng: string, @Query('radiusKm') radiusKm?: string) {
    return this.stations.nearby(Number(lat), Number(lng), Number(radiusKm ?? 10));
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.stations.byId(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: any) {
    return this.stations.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.stations.update(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.stations.archive(id);
  }
}
