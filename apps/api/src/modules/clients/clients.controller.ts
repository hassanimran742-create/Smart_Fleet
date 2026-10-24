import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { ClientAddressCreateResult, ClientAddressDto, ClientUpdateResult } from '@smartfleet/shared-types';
import {
  clientsQuerySchema,
  createClientAddressSchema,
  createClientSchema,
  updateClientSchema,
  type ClientsQuery,
  type CreateClientAddressInput,
  type CreateClientInput,
  type UpdateClientInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { IdempotencyKey } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { UuidParam } from '../orders/support/uuid-param.pipe';
import { ClientsService, type ClientRow } from './clients.service';

/**
 * Customers (API_CONTRACT §7.4): DISTRIBUTOR exact for its own customers; the office only reads, and
 * must say whose customers with `?distributorId=`. Distributor-scoped reads always use the token's
 * distributor, never a query value.
 */
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @ExactRoles(UserRole.DISTRIBUTOR, UserRole.SUPER_ADMIN)
  @Get()
  list(@CurrentActor() actor: UserActor, @Query(new ZodQuery(clientsQuerySchema)) query: ClientsQuery): Promise<ClientRow[]> {
    if (actor.role === UserRole.DISTRIBUTOR) return this.clients.list(ownDistributorId(actor));
    if (!query.distributorId) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'distributorId', code: 'REQUIRED', message: validationMessage('REQUIRED') }],
      });
    }
    return this.clients.list(query.distributorId);
  }

  @ExactRoles(UserRole.DISTRIBUTOR)
  @Post()
  create(
    @CurrentActor() actor: UserActor,
    @IdempotencyKey() key: string | undefined,
    @Body(new ZodBody(createClientSchema)) body: CreateClientInput,
  ) {
    return this.clients.create(ownDistributorId(actor), body, key);
  }

  /** [Inc 2] Fix a customer's name, phone or notes (API_CONTRACT §9.4); the addresses stay add-only. */
  @ExactRoles(UserRole.DISTRIBUTOR)
  @Patch(':id')
  update(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam('CLIENT_NOT_FOUND')) id: string,
    @Body(new ZodBody(updateClientSchema)) body: UpdateClientInput,
  ): Promise<ClientUpdateResult> {
    return this.clients.update(actor, id, body);
  }

  @ExactRoles(UserRole.DISTRIBUTOR, UserRole.SUPER_ADMIN)
  @Get(':id/addresses')
  addresses(@CurrentActor() actor: UserActor, @Param('id', new UuidParam('CLIENT_NOT_FOUND')) id: string): Promise<ClientAddressDto[]> {
    return this.clients.listAddresses(actor, id);
  }

  @ExactRoles(UserRole.DISTRIBUTOR)
  @Post(':id/addresses')
  addAddress(
    @CurrentActor() actor: UserActor,
    @Param('id', new UuidParam('CLIENT_NOT_FOUND')) id: string,
    @Body(new ZodBody(createClientAddressSchema)) body: CreateClientAddressInput,
  ): Promise<ClientAddressCreateResult> {
    return this.clients.addAddress(actor, id, body);
  }
}
