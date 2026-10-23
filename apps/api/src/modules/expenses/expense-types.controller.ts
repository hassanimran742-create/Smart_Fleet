import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { ExpenseTypeDto } from '@smartfleet/shared-types';
import {
  createExpenseTypeSchema,
  expenseTypesQuerySchema,
  renameExpenseTypeSchema,
  type CreateExpenseTypeInput,
  type ExpenseTypesQuery,
  type RenameExpenseTypeInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import type { IdempotentResponse } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { ExpenseTypesService } from './expense-types.service';

/** Expense types (API_CONTRACT §7.12): office exact, zod-validated, audited as `expense_type.*`. */
@Controller('expense-types')
@ExactRoles(UserRole.SUPER_ADMIN)
export class ExpenseTypesController {
  constructor(private readonly types: ExpenseTypesService) {}

  @Get()
  list(@Query(new ZodQuery(expenseTypesQuerySchema)) query: ExpenseTypesQuery): Promise<ExpenseTypeDto[]> {
    return this.types.list(query.includeArchived ?? false);
  }

  /** `{ name (2–40) }` → 201; EXPENSE_TYPE_NAME_TAKEN `{name}` when the name (any case or spacing) is used. */
  @Post()
  create(
    @Body(new ZodBody(createExpenseTypeSchema)) body: CreateExpenseTypeInput,
    @CurrentActor() actor: UserActor,
  ): Promise<ExpenseTypeDto> {
    return this.types.create(body.name, actor);
  }

  /** `{ name }` → 200; the type's code never changes. */
  @Patch(':id')
  rename(
    @Param('id') id: string,
    @Body(new ZodBody(renameExpenseTypeSchema)) body: RenameExpenseTypeInput,
    @CurrentActor() actor: UserActor,
  ): Promise<ExpenseTypeDto> {
    return this.types.rename(id, body.name, actor);
  }

  /** 200; Petrol and Other give 409 EXPENSE_TYPE_LOCKED; a repeat answers 200 `X-Already-Applied`. */
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string, @CurrentActor() actor: UserActor): Promise<ExpenseTypeDto | IdempotentResponse<ExpenseTypeDto>> {
    return this.types.archive(id, actor);
  }

  /** 200; a repeat answers 200 `X-Already-Applied`. */
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string, @CurrentActor() actor: UserActor): Promise<ExpenseTypeDto | IdempotentResponse<ExpenseTypeDto>> {
    return this.types.restore(id, actor);
  }
}
