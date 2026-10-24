import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { CylinderHistoryDto } from '@smartfleet/shared-types';
import { bulkRegisterSchema, type BulkRegisterInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { CylinderHistoryService } from '../custody/history.service';
import { CylindersService } from './cylinders.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cylinders (API_CONTRACT §7.2, §9.4, §9.5). */
@Controller('cylinders')
export class CylindersController {
  constructor(
    private readonly cylinders: CylindersService,
    private readonly history: CylinderHistoryService,
  ) {}

  /** The office or the owning distributor; anyone else's cylinder is 404. */
  @Roles(UserRole.DISTRIBUTOR)
  @Get('by-qr/:qr')
  byQr(@CurrentActor() actor: UserActor, @Param('qr') qr: string) {
    return this.cylinders.findByQr(actor, qr);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get()
  list(@Query('distributorId') distributorId?: string) {
    if (distributorId !== undefined && distributorId !== '' && !UUID.test(distributorId)) throw new AppError('NOT_FOUND');
    return this.cylinders.list(distributorId || undefined);
  }

  /**
   * [Inc 2] The holder, the responsible driver and every move (the office's Find cylinder). `:code` is a
   * QR value or a cylinder number: the owning distributor may type 42, 0042, C0042 or AG-C0042; the
   * office needs the QR value or the full AG-C0042. A driver gets 403; another distributor's cylinder 404.
   */
  @Roles(UserRole.DISTRIBUTOR)
  @Get(':code/history')
  cylinderHistory(@CurrentActor() actor: UserActor, @Param('code') code: string): Promise<CylinderHistoryDto> {
    return this.history.byCode(actor, code);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post('bulk-register')
  bulkRegister(@CurrentActor() actor: UserActor, @Body(new ZodBody(bulkRegisterSchema)) body: BulkRegisterInput) {
    return this.cylinders.bulkRegister(actor, body);
  }
}
