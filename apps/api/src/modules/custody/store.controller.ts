import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { StoreIncomingDto, StoreStockDto } from '@smartfleet/shared-types';
import { storeScanSchema, type StoreScanInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { ScanService, scanResponse } from './scan.service';
import { StoreService } from './store.service';

/**
 * The shop app's store routes (API_CONTRACT §9.4): DISTRIBUTOR exact, no office bypass. The store scans
 * in what drivers bring back; the driver has no unload scan, and no body field can name a store.
 */
@Controller('store')
@ExactRoles(UserRole.DISTRIBUTOR)
export class StoreController {
  constructor(
    private readonly scans: ScanService,
    private readonly store: StoreService,
  ) {}

  /** RECEIVE (SCAN_IN): 201 RECORDED; a resend 200 `Idempotent-Replay`; already in the store 200 `X-Already-Applied`. */
  @Post('scans')
  async scan(@CurrentActor() actor: UserActor, @Body(new ZodBody(storeScanSchema)) body: StoreScanInput) {
    return scanResponse(await this.scans.storeScan(actor, { scanId: body.scanId.toLowerCase(), code: body.code, entryMethod: body.entryMethod }));
  }

  @Get('incoming')
  incoming(@CurrentActor() actor: UserActor): Promise<StoreIncomingDto> {
    return this.store.incoming(actor);
  }

  @Get('stock')
  stock(@CurrentActor() actor: UserActor): Promise<StoreStockDto> {
    return this.store.stock(actor);
  }
}
