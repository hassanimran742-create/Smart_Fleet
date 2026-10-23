import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { LocationQuote, PriceGridDto, PriceGridZone } from '@smartfleet/shared-types';
import {
  legacyPricingRuleSchema,
  locationQuoteQuerySchema,
  putPriceSchema,
  removePriceSchema,
  type LegacyPricingRuleInput,
  type LocationQuoteQuery,
  type PutPriceInput,
  type RemovePriceInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import type { IdempotentResponse } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { PricingService } from './pricing.service';

/** The office must name the distributor whose price it wants; a distributor always gets its own. */
function requireDistributorId(actor: UserActor, query: LocationQuoteQuery): string {
  if (actor.role === UserRole.DISTRIBUTOR) return ownDistributorId(actor);
  if (!query.distributorId) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'distributorId', code: 'REQUIRED', message: validationMessage('REQUIRED') }],
    });
  }
  return query.distributorId;
}

/** Delivery prices and the location quote (API_CONTRACT §7.5), and the frozen legacy routes (§7.2). */
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get('prices/:distributorId')
  grid(@Param('distributorId', new UuidParam()) distributorId: string): Promise<PriceGridDto> {
    return this.pricing.grid(distributorId);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Put('prices/:distributorId/:zoneId')
  put(
    @CurrentActor() actor: UserActor,
    @Param('distributorId', new UuidParam()) distributorId: string,
    @Param('zoneId', new UuidParam()) zoneId: string,
    @Body(new ZodBody(putPriceSchema)) body: PutPriceInput,
  ): Promise<PriceGridZone> {
    return this.pricing.putPrice(actor, distributorId, zoneId, body);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Delete('prices/:distributorId/:zoneId')
  remove(
    @CurrentActor() actor: UserActor,
    @Param('distributorId', new UuidParam()) distributorId: string,
    @Param('zoneId', new UuidParam()) zoneId: string,
    @Body(new ZodBody(removePriceSchema)) body: RemovePriceInput,
  ): Promise<PriceGridZone | IdempotentResponse<PriceGridZone>> {
    return this.pricing.removePrice(actor, distributorId, zoneId, body.reason);
  }

  /** Always 200 for a well-formed pin: a blocked one carries `blockCode`. */
  @ExactRoles(UserRole.DISTRIBUTOR, UserRole.SUPER_ADMIN)
  @Get('quote')
  quote(@CurrentActor() actor: UserActor, @Query(new ZodQuery(locationQuoteQuerySchema)) query: LocationQuoteQuery): Promise<LocationQuote> {
    return this.pricing.quoteLocation(requireDistributorId(actor, query), { lat: query.lat, lng: query.lng });
  }

  /** Legacy, frozen: zone-pair rules. No quote, order or fee reads them. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get('city/:cityId')
  legacyList(@Param('cityId', new UuidParam()) cityId: string) {
    return this.pricing.listLegacyRules(cityId);
  }

  /** Legacy, frozen: writes `pricing_rules` as today. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post('rules')
  legacyUpsert(@Body(new ZodBody(legacyPricingRuleSchema)) body: LegacyPricingRuleInput) {
    return this.pricing.upsertLegacyRule(body);
  }
}
