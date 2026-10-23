import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createCitySchema, type CreateCityInput } from '@smartfleet/shared-validation';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { CitiesService } from './cities.service';

/** Cities: any signed-in user reads them; only the office adds one (API_CONTRACT §7.2). */
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

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post()
  create(@Body(new ZodBody(createCitySchema)) body: CreateCityInput) {
    return this.cities.createCity(body);
  }
}
