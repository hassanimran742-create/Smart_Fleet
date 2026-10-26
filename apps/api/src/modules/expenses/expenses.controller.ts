import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { ExpenseDto, ExpenseSummary, Page } from '@smartfleet/shared-types';
import {
  createExpenseSchema,
  expenseSummaryQuerySchema,
  expensesQuerySchema,
  updateExpenseSchema,
  voidExpenseSchema,
  type CreateExpenseInput,
  type ExpenseSummaryQuery,
  type ExpensesQuery,
  type UpdateExpenseInput,
  type VoidExpenseInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { IdempotencyKey, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { ExpensesService } from './expenses.service';

/**
 * Expenses (API_CONTRACT §7.12): office exact, zod-validated, audited. `DELETE /expenses/:id` is gone:
 * removing an expense is `POST /expenses/:id/void` with a reason.
 */
@Controller('expenses')
@ExactRoles(UserRole.SUPER_ADMIN)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /** `?from&to&typeId&vehicleId&driverId&includeVoided&cursor&limit` → `Page<ExpenseDto>`. */
  @Get()
  list(@Query(new ZodQuery(expensesQuerySchema)) query: ExpensesQuery): Promise<Page<ExpenseDto>> {
    return this.expenses.list(query);
  }

  /** `?from&to` → totals by type and by month, and the drivers' fuel logs beside them. */
  @Get('summary')
  summary(@Query(new ZodQuery(expenseSummaryQuerySchema)) query: ExpenseSummaryQuery): Promise<ExpenseSummary> {
    return this.expenses.summary(query);
  }

  /** 201 with the expense; a retry with the same Idempotency-Key answers 200 `Idempotent-Replay`. */
  @Post()
  create(
    @Body(new ZodBody(createExpenseSchema)) body: CreateExpenseInput,
    @IdempotencyKey() key: string | undefined,
    @CurrentActor() actor: UserActor,
  ): Promise<ExpenseDto | IdempotentResponse<ExpenseDto>> {
    return this.expenses.create(body, key, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateExpenseSchema)) body: UpdateExpenseInput,
    @CurrentActor() actor: UserActor,
  ): Promise<ExpenseDto> {
    return this.expenses.update(id, body, actor);
  }

  /** `{ reason (5–200) }` → 200; a repeat answers 200 `X-Already-Applied`. */
  @Post(':id/void')
  @HttpCode(200)
  voidExpense(
    @Param('id') id: string,
    @Body(new ZodBody(voidExpenseSchema)) body: VoidExpenseInput,
    @CurrentActor() actor: UserActor,
  ): Promise<ExpenseDto | IdempotentResponse<ExpenseDto>> {
    return this.expenses.voidExpense(id, body, actor);
  }
}
