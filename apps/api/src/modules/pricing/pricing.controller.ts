import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('city/:cityId')
  list(@Param('cityId') cityId: string) {
    return this.pricing.list(cityId);
  }

  @Roles(UserRole.ADMIN)
  @Post('rules')
  upsert(@Body() body: any) {
    return this.pricing.upsertRule(body);
  }
}
