import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createCylinderTypeSchema, type CreateCylinderTypeInput } from '@smartfleet/shared-validation';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { CylinderTypesService } from './cylinder-types.service';

/** Cylinder sizes: any signed-in user reads them; only the office adds one (API_CONTRACT §7.2). */
@Controller('cylinder-types')
export class CylinderTypesController {
  constructor(private readonly types: CylinderTypesService) {}

  @Get()
  list() {
    return this.types.list();
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post()
  create(@Body(new ZodBody(createCylinderTypeSchema)) body: CreateCylinderTypeInput) {
    return this.types.create(body);
  }
}
