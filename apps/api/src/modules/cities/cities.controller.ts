import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CitiesService } from './cities.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  list() {
    return this.cities.list();
  }

  @Get(':id/areas')
  areas(@Param('id') id: string) {
    return this.cities.areasForCity(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: { name: string; countryCode?: string }) {
    return this.cities.createCity(body);
  }
}
