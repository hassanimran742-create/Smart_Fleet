import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AdminWalletDetail, AdminWalletRow, Page, StatementItem, WalletCorrectionResult } from '@smartfleet/shared-types';
import {
  statementQuerySchema,
  walletCorrectionSchema,
  type StatementQuery,
  type WalletCorrectionInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { REQUEST_HEADER } from '../../common/http/headers';
import { readIdempotencyKey, replayed, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { pathId } from './caller';
import { WalletAdminService } from './wallet-admin.service';
import { WalletService } from './wallet.service';

/** The office's wallet routes (API_CONTRACT §7.8). SUPER_ADMIN exact. */
@Controller('admin')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AdminWalletsController {
  constructor(
    private readonly admin: WalletAdminService,
    private readonly wallet: WalletService,
  ) {}

  /** `GET /admin/wallets`: every distributor's balance, low-balance flag, money being checked and last approved top-up. */
  @Get('wallets')
  list(): Promise<AdminWalletRow[]> {
    return this.admin.list();
  }

  /** `GET /admin/distributors/:id/wallet`: the summary plus a live integrity check (it only reads). */
  @Get('distributors/:id/wallet')
  detail(@Param('id') id: string): Promise<AdminWalletDetail> {
    return this.admin.detail(pathId(id));
  }

  /** `GET /admin/distributors/:id/wallet/statement`: the full history, with notes, authors and bank references. */
  @Get('distributors/:id/wallet/statement')
  statement(@Param('id') id: string, @Query(new ZodQuery(statementQuerySchema)) query: StatementQuery): Promise<Page<StatementItem>> {
    return this.wallet.statement(pathId(id), query, 'OFFICE');
  }

  /**
   * `POST /admin/distributors/:id/wallet/corrections`: 201 `{ entry, wallet }`. Rules in order: the body
   * (400), the Idempotency-Key, which is required here (400 `REQUIRED` before anything is read), then the
   * wallet's own rules. The same key and body again: 200 `Idempotent-Replay` with the first entry.
   */
  @Post('distributors/:id/wallet/corrections')
  async correct(
    @Param('id') id: string,
    @Body(new ZodBody(walletCorrectionSchema)) body: WalletCorrectionInput,
    @Headers(REQUEST_HEADER.idempotencyKey) idempotencyKey: string | undefined,
    @CurrentActor() actor: UserActor,
  ): Promise<WalletCorrectionResult | IdempotentResponse<WalletCorrectionResult>> {
    const requestKey = readIdempotencyKey(idempotencyKey, { required: true }) as string;
    const result = await this.admin.correct(pathId(id), body, requestKey, actor);
    return result.replayed ? replayed(result.body) : result.body;
  }
}
