import { Controller, Get, Param, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('reports')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('orders-by-zone/:cityId')
  byZone(@Param('cityId') cityId: string, @Query('since') since?: string) {
    return this.reports.ordersByZone(
      cityId,
      since ? new Date(since) : new Date(Date.now() - 30 * 24 * 3600 * 1000),
    );
  }

  @Get('driver-utilization')
  driverUtilization(@Query('since') since?: string) {
    return this.reports.driverUtilization(
      since ? new Date(since) : new Date(Date.now() - 7 * 24 * 3600 * 1000),
    );
  }
}
