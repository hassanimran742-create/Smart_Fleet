import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { PaymentStatus, UserRole } from '@prisma/client';
import type { InitiateTopupResponse, PaymentDto, TopupApproveResult, TopupInfoDto } from '@smartfleet/shared-types';
import {
  approveTopupSchema,
  bankProofSchema,
  rejectTopupSchema,
  topupRequestSchema,
  topupSchema,
  verifyPaymentSchema,
  type ApproveTopupInput,
  type BankProofInput,
  type RejectTopupInput,
  type TopupInput,
  type TopupRequestInput,
  type VerifyPaymentInput,
} from '@smartfleet/shared-validation';
import { z } from 'zod';
import type { UserActor } from '../../common/auth/actor';
import { AuthContext, CurrentActor, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, IdempotencyKey, replayed, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { ownDistributorId } from '../wallet/caller';
import { TopupService, type LegacyPaymentRow, type Repeatable } from './topup.service';

/** Legacy `GET /payments?status=`: one PaymentStatus, or blank for all. */
const legacyListQuerySchema = z.object({
  status: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.nativeEnum(PaymentStatus).optional(),
  ),
});
type LegacyListQuery = z.infer<typeof legacyListQuerySchema>;

function asReplay<T>(result: Repeatable<T>): T | IdempotentResponse<T> {
  return result.repeated ? replayed(result.body) : result.body;
}

function asRepeat<T>(result: Repeatable<T>): T | IdempotentResponse<T> {
  return result.repeated ? alreadyApplied(result.body) : result.body;
}

/**
 * Top-ups (API_CONTRACT §7.9). Creates answer 201 (a replay 200 with `Idempotent-Replay`); every
 * action sent as POST answers 200 (a repeat with `X-Already-Applied`). Static paths are declared before
 * `:id`, so `mine` and `topup-info` are never read as ids.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly topups: TopupService) {}

  /** `GET /payments/topup-info` (DISTRIBUTOR exact): the company account, limits and pending requests. */
  @Get('topup-info')
  @ExactRoles(UserRole.DISTRIBUTOR)
  info(@CurrentUser() user: AuthContext): Promise<TopupInfoDto> {
    return this.topups.info(ownDistributorId(user));
  }

  /** `POST /payments/topup-requests` (DISTRIBUTOR exact, Idempotency-Key): "tell us you paid". */
  @Post('topup-requests')
  @ExactRoles(UserRole.DISTRIBUTOR)
  async createRequest(
    @CurrentActor() actor: UserActor,
    @Body(new ZodBody(topupRequestSchema)) body: TopupRequestInput,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<PaymentDto | IdempotentResponse<PaymentDto>> {
    ownDistributorId(actor);
    return asReplay(await this.topups.createRequest(actor, body, idempotencyKey));
  }

  /** `GET /payments/mine` (DISTRIBUTOR exact): a bare array, newest first. */
  @Get('mine')
  @ExactRoles(UserRole.DISTRIBUTOR)
  mine(@CurrentUser() user: AuthContext): Promise<PaymentDto[]> {
    return this.topups.mine(ownDistributorId(user));
  }

  /** Legacy `POST /payments/topup` (DISTRIBUTOR exact): BANK_MANUAL only, answering the old shape. */
  @Post('topup')
  @ExactRoles(UserRole.DISTRIBUTOR)
  async legacyTopup(
    @CurrentActor() actor: UserActor,
    @Body(new ZodBody(topupSchema)) body: TopupInput,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<InitiateTopupResponse | IdempotentResponse<InitiateTopupResponse>> {
    ownDistributorId(actor);
    return asReplay(await this.topups.legacyTopup(actor, body, idempotencyKey));
  }

  /** `POST /payments/webhook/:provider`: online payments are off. It never reads or changes a payment. */
  @Public()
  @Post('webhook/:provider')
  webhook(): never {
    throw new AppError('PAYMENT_WEBHOOK_DISABLED');
  }

  /** Legacy `GET /payments?status=` (office, kept for one release): the old office screen's list. */
  @Get()
  @ExactRoles(UserRole.SUPER_ADMIN)
  legacyList(@Query(new ZodQuery(legacyListQuerySchema)) query: LegacyListQuery): Promise<LegacyPaymentRow[]> {
    return this.topups.legacyList(query.status);
  }

  /** `GET /payments/:id`: the office or the owning distributor (`canSeePayment`); others 404. */
  @Get(':id')
  @Roles(UserRole.DISTRIBUTOR)
  byId(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<PaymentDto> {
    return this.topups.byId(user, id);
  }

  /** `POST /payments/:id/approve` (office): credits the wallet once, against the company bank app. */
  @Post(':id/approve')
  @HttpCode(200)
  @ExactRoles(UserRole.SUPER_ADMIN)
  async approve(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(approveTopupSchema)) body: ApproveTopupInput,
    // Read so a malformed key is refused like everywhere else; approval itself is keyed `topup:<id>`.
    @IdempotencyKey() _idempotencyKey: string | undefined,
  ): Promise<TopupApproveResult | IdempotentResponse<TopupApproveResult>> {
    return asRepeat(await this.topups.approve(actor, id, body));
  }

  /** `POST /payments/:id/reject` (office): `{ reasonCode, note? }`, no money. */
  @Post(':id/reject')
  @HttpCode(200)
  @ExactRoles(UserRole.SUPER_ADMIN)
  async reject(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(rejectTopupSchema)) body: RejectTopupInput,
  ): Promise<{ payment: PaymentDto } | IdempotentResponse<{ payment: PaymentDto }>> {
    return asRepeat(await this.topups.reject(actor, id, body));
  }

  /** Legacy `POST /payments/:id/bank-proof` (DISTRIBUTOR exact): the screenshot of an own request being checked. */
  @Post(':id/bank-proof')
  @HttpCode(200)
  @ExactRoles(UserRole.DISTRIBUTOR)
  bankProof(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(bankProofSchema)) body: BankProofInput,
  ): Promise<PaymentDto> {
    return this.topups.attachLegacyProof(actor, id, body.proofUrl);
  }

  /** Legacy `POST /payments/:id/verify` (office): `false` rejects; `true` needs the new approve route. */
  @Post(':id/verify')
  @HttpCode(200)
  @ExactRoles(UserRole.SUPER_ADMIN)
  async verify(
    @CurrentActor() actor: UserActor,
    @Param('id') id: string,
    @Body(new ZodBody(verifyPaymentSchema)) body: VerifyPaymentInput,
  ): Promise<{ payment: PaymentDto } | IdempotentResponse<{ payment: PaymentDto }>> {
    return asRepeat(await this.topups.legacyVerify(actor, id, body.approve));
  }
}
