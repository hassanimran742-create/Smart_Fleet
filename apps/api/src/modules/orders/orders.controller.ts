import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { OrderBoardDto, OrderDto, OrderQuoteResult, Page } from '@smartfleet/shared-types';
import {
  assignDriverSchema,
  cancelOrderSchema,
  createOrderSchema,
  failOrderSchema,
  manualDeliveryV2Schema,
  officeCancelOrderSchema,
  officeFailOrderSchema,
  orderBoardQuerySchema,
  ordersQuerySchema,
  quoteOrderSchema,
  updateOrderStatusSchema,
  type AssignDriverInput,
  type CreateOrderInput,
  type ManualDeliveryV2Input,
  type OrderBoardQuery,
  type OrdersQuery,
  type QuoteOrderInput,
  type UpdateOrderStatusInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles, Roles } from '../../common/decorators/roles.decorator';
import { IdempotencyKey } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { OrdersService, type OrderTracking } from './orders.service';
import { UuidParam } from './support/uuid-param.pipe';

/**
 * Orders (API_CONTRACT §7.6). Placing and quoting are the distributor's own actions (exact role);
 * cancel and fail are open to the office too, plus an ownership check (404 for anyone else's order).
 * Every action sent as POST answers 200; only a placed order answers 201.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ExactRoles(UserRole.DISTRIBUTOR)
  @Post()
  create(
    @CurrentActor() actor: UserActor,
    @IdempotencyKey() key: string | undefined,
    @Body(new ZodBody(createOrderSchema)) body: CreateOrderInput,
  ) {
    return this.orders.create(actor, body, key);
  }

  @ExactRoles(UserRole.DISTRIBUTOR)
  @Post('quote')
  @HttpCode(200)
  quote(@CurrentActor() actor: UserActor, @Body(new ZodBody(quoteOrderSchema)) body: QuoteOrderInput): Promise<OrderQuoteResult> {
    return this.orders.quote(actor, body);
  }

  /** The shop's orders: a bare array without `tab` (installed apps), a cursor page with it. */
  @ExactRoles(UserRole.DISTRIBUTOR)
  @Get()
  list(@CurrentActor() actor: UserActor, @Query(new ZodQuery(ordersQuerySchema)) query: OrdersQuery): Promise<OrderDto[] | Page<OrderDto>> {
    return this.orders.list(actor, query);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get('board')
  board(@CurrentActor() actor: UserActor, @Query(new ZodQuery(orderBoardQuerySchema)) query: OrderBoardQuery): Promise<OrderBoardDto> {
    return this.orders.board(actor, query);
  }

  /** Legacy office array, kept for one release. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Get('all')
  listAll(@Query('status') status?: string) {
    return this.orders.listAll(status);
  }

  @Roles(UserRole.DISTRIBUTOR)
  @Get(':id/tracking')
  tracking(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string): Promise<OrderTracking> {
    return this.orders.tracking(actor, id);
  }

  @Roles(UserRole.DISTRIBUTOR, UserRole.DRIVER)
  @Get(':id')
  byId(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string): Promise<OrderDto> {
    return this.orders.byId(actor, id);
  }

  /** The owning distributor (note optional except for OTHER) or the office (note always, 5–300). */
  @Roles(UserRole.DISTRIBUTOR)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @IdempotencyKey() _key: string | undefined,
    @Body() body: unknown,
  ) {
    const command =
      actor.role === UserRole.SUPER_ADMIN ? new ZodBody(officeCancelOrderSchema).transform(body) : new ZodBody(cancelOrderSchema).transform(body);
    return this.orders.cancel(actor, id, command);
  }

  /** The trip's driver (note for OTHER) or the office (note always, 5–300). */
  @Roles(UserRole.DRIVER)
  @Post(':id/fail')
  @HttpCode(200)
  fail(@CurrentActor() actor: UserActor, @Param('id', new UuidParam()) id: string, @Body() body: unknown) {
    const command =
      actor.role === UserRole.SUPER_ADMIN ? new ZodBody(officeFailOrderSchema).transform(body) : new ZodBody(failOrderSchema).transform(body);
    return this.orders.fail(actor, id, command);
  }

  /** Legacy status changes, with from-state rules. DRIVER and the office only. */
  @Roles(UserRole.DRIVER)
  @Patch(':id/status')
  setStatus(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(updateOrderStatusSchema)) body: UpdateOrderStatusInput,
  ) {
    return this.orders.updateStatus(actor, id, body);
  }

  /** A legacy `originStoreId` is dropped: every trip starts at the distributor's store. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post(':id/assign-driver')
  @HttpCode(200)
  assignDriver(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(assignDriverSchema)) body: AssignDriverInput,
  ) {
    return this.orders.assignDriver(actor, id, body);
  }

  /** [Inc 2] v2: the office names the cylinders handed over (and, optionally, those taken back). No money. */
  @ExactRoles(UserRole.SUPER_ADMIN)
  @Post(':id/manual-delivery')
  @HttpCode(200)
  manualDelivery(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam()) id: string,
    @Body(new ZodBody(manualDeliveryV2Schema)) body: ManualDeliveryV2Input,
  ) {
    return this.orders.manualDelivery(actor, id, body);
  }
}
