import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AdminTopupsDto } from '@smartfleet/shared-types';
import { adminTopupsQuerySchema, type AdminTopupsQuery } from '@smartfleet/shared-validation';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-body.pipe';
import { TopupService } from './topup.service';

/** The office's top-up queue (API_CONTRACT §7.9). SUPER_ADMIN exact. */
@Controller('admin/topups')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AdminTopupsController {
  constructor(private readonly topups: TopupService) {}

  /** `GET /admin/topups?tab=to-check|approved|rejected|all&q&cursor&limit`. */
  @Get()
  list(@Query(new ZodQuery(adminTopupsQuerySchema)) query: AdminTopupsQuery): Promise<AdminTopupsDto> {
    return this.topups.adminList(query);
  }
}
