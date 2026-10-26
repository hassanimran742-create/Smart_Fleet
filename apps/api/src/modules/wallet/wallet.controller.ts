import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Page, StatementItem, WalletSummary } from '@smartfleet/shared-types';
import { statementQuerySchema, type StatementQuery } from '@smartfleet/shared-validation';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-body.pipe';
import { ownDistributorId } from './caller';
import { WalletService } from './wallet.service';

/**
 * The shop's own wallet (API_CONTRACT §7.8), DISTRIBUTOR exact: no office bypass, and the distributor
 * is always the token's. A `distributorId` sent in the query is ignored.
 */
@Controller('wallet')
@ExactRoles(UserRole.DISTRIBUTOR)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** `GET /wallet`: the balance, money being checked, the low-balance flag and the cap. */
  @Get()
  summary(@CurrentUser() user: AuthContext): Promise<WalletSummary> {
    return this.wallet.summary(ownDistributorId(user));
  }

  /** `GET /wallet/statement?kind&from&to&cursor&limit`: the ledger, newest first, without office notes. */
  @Get('statement')
  statement(
    @CurrentUser() user: AuthContext,
    @Query(new ZodQuery(statementQuerySchema)) query: StatementQuery,
  ): Promise<Page<StatementItem>> {
    return this.wallet.statement(ownDistributorId(user), query, 'DISTRIBUTOR');
  }
}
