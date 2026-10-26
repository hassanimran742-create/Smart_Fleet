import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  createTicketSchema,
  ticketsQuerySchema,
  ticketStatusSchema,
  type CreateTicketInput,
  type TicketsQuery,
  type TicketStatusInput,
} from '@smartfleet/shared-validation';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { Feature } from '../../common/features/feature';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { SupportService } from './support.service';

/** Support tickets: switched off for the pilot (ADR-04, `features.support`). */
@Feature('support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@CurrentUser() user: AuthContext, @Body(new ZodBody(createTicketSchema)) body: CreateTicketInput) {
    return this.support.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: AuthContext, @Query(new ZodQuery(ticketsQuerySchema)) query: TicketsQuery) {
    return this.support.list(user, query.status);
  }

  @ExactRoles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body(new ZodBody(ticketStatusSchema)) body: TicketStatusInput) {
    return this.support.setStatus(id, body.status);
  }
}
