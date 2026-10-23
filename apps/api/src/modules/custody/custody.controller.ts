import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { custodyScanSchema, type CustodyScanInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { CustodyService } from './custody.service';

/**
 * Cylinder custody (API_CONTRACT §7.7). The legacy scan route is the installed driver app's: DRIVER
 * exact (no office bypass), `tripId` required, and the client can't choose where a cylinder goes.
 */
@Controller('custody')
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}

  @ExactRoles(UserRole.DRIVER)
  @Post('scan')
  scan(@CurrentActor() actor: UserActor, @Body(new ZodBody(custodyScanSchema)) body: CustodyScanInput) {
    return this.custody.legacyScan(actor, body);
  }

  /** The office or the owning distributor; a driver gets 403. */
  @Roles(UserRole.DISTRIBUTOR)
  @Get('cylinders/:id/history')
  history(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string) {
    return this.custody.history(actor, id);
  }
}
