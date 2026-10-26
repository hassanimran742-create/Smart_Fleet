import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { newLinkSchema, shareSchema, type NewLinkInput, type ShareInput } from '@smartfleet/shared-validation';
import type { Response } from 'express';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { SettingSwitch } from '../../common/features/feature';
import { RESPONSE_HEADER } from '../../common/http/headers';
import { IdempotencyKey } from '../../common/idempotency/idempotency';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { ConfirmationService } from './confirmation.contract';

/**
 * The customer confirmation for the shop app and the office (API_CONTRACT §9.7, CUSTOMER_PAGE §10).
 *
 * Common checks, in order: the switch (`confirmation.enabled` off: 403 FEATURE_DISABLED with
 * `X-Feature-Disabled: confirmations`, for every caller); a driver or another distributor 404 (the one
 * place a driver gets 404 rather than 403, §3.2: the driver never sees the link); not DELIVERED 409
 * CONFIRM_NOT_READY; no confirmation row 404 NOT_FOUND. `@Roles(DISTRIBUTOR, DRIVER)` lets the office
 * through too, and lets a driver reach the 404.
 */
@Controller('orders')
@SettingSwitch('confirmation.enabled', 'confirmations')
@Roles(UserRole.DISTRIBUTOR, UserRole.DRIVER)
export class ConfirmationController {
  constructor(private readonly confirmations: ConfirmationService) {}

  /** `GET /orders/:id/confirmation`: the `ConfirmationView`. */
  @Get(':id/confirmation')
  view(@Param('id') id: string, @CurrentActor() actor: UserActor) {
    return this.confirmations.view(id, actor);
  }

  /** `POST /orders/:id/confirmation/share` `{ via }`: the link and the message to pass on, never cached. */
  @Post(':id/confirmation/share')
  @HttpCode(200)
  async share(
    @Param('id') id: string,
    @Body(new ZodBody(shareSchema)) body: ShareInput,
    @IdempotencyKey() key: string | undefined,
    @CurrentActor() actor: UserActor,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      return await this.confirmations.share(id, body.via, key, actor);
    } catch (error) {
      if (AppError.is(error, 'RATE_LIMITED')) {
        res.setHeader(RESPONSE_HEADER.retryAfter, String(Math.max(1, error.details.minutes) * 60));
      }
      throw error;
    }
  }

  /**
   * `POST /orders/:id/confirmation/new-link` `{ send?: 'SMS' }`: a new link (the old one stops working). With
   * `send: 'SMS'`, at most 3 texts per order and 20 per shop an hour (429 RATE_LIMITED with Retry-After).
   */
  @Post(':id/confirmation/new-link')
  @HttpCode(200)
  async newLink(
    @Param('id') id: string,
    @Body(new ZodBody(newLinkSchema)) body: NewLinkInput,
    @IdempotencyKey() key: string | undefined,
    @CurrentActor() actor: UserActor,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return await this.confirmations.newLink(id, { send: body.send, idempotencyKey: key }, actor);
    } catch (error) {
      if (AppError.is(error, 'RATE_LIMITED')) {
        res.setHeader(RESPONSE_HEADER.retryAfter, String(Math.max(1, error.details.minutes) * 60));
      }
      throw error;
    }
  }
}
