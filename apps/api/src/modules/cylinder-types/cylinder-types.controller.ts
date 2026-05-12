import { Body, Controller, Get, Post } from '@nestjs/common';
import { CylinderTypesService } from './cylinder-types.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('cylinder-types')
export class CylinderTypesController {
  constructor(private readonly types: CylinderTypesService) {}

  @Get()
  list() {
    return this.types.list();
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: any) {
    return this.types.create(body);
  }
}
