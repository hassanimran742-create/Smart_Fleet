import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AdminSummaryDto } from '@smartfleet/shared-types';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { AdminSummaryService } from './admin-summary.service';

@Controller('admin/summary')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AdminSummaryController {
  constructor(private readonly summaries: AdminSummaryService) {}

  @Get()
  summary(): Promise<AdminSummaryDto> {
    return this.summaries.summary();
  }
}
