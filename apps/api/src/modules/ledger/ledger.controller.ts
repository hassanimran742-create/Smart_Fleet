import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { LedgerBalanceDto } from '@smartfleet/shared-types';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ownDistributorId } from '../wallet/caller';
import { LedgerService, type LedgerRowDto } from './ledger.service';

/**
 * Compatibility routes the installed shop app calls (API_CONTRACT §7.8, Appendix A). DISTRIBUTOR exact:
 * the office reads wallets through `/admin/...`, and nobody reads another distributor's ledger here.
 */
@Controller('ledger')
@ExactRoles(UserRole.DISTRIBUTOR)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /** `GET /ledger/me`: a bare array of the caller's newest 100 ledger rows. */
  @Get('me')
  mine(@CurrentUser() user: AuthContext): Promise<LedgerRowDto[]> {
    return this.ledger.listForDistributor(ownDistributorId(user));
  }

  /** `GET /ledger/balance`: `{ balancePaisa, pendingTopupPaisa }`. */
  @Get('balance')
  balance(@CurrentUser() user: AuthContext): Promise<LedgerBalanceDto> {
    return this.ledger.balanceOf(ownDistributorId(user));
  }
}
