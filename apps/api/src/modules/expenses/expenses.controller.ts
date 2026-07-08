import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { ExpenseCategory, UserRole } from '@prisma/client';

@Controller('expenses')
@Roles(UserRole.SUPER_ADMIN)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(
    @Query('category') category?: ExpenseCategory,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    return this.expenses.list({
      category,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
    });
  }

  @Get('summary')
  summary(@Query('since') since?: string, @Query('until') until?: string) {
    return this.expenses.summary(
      since ? new Date(since) : undefined,
      until ? new Date(until) : undefined,
    );
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.expenses.create({ ...body, recordedByUserId: user.userId });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.expenses.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.expenses.delete(id);
  }
}
