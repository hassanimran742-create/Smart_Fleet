import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AlertRulesService } from './alert-rules.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { AlertRuleKind, AlertSeverity, UserRole } from '@prisma/client';

@Controller('alert-rules')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AlertRulesController {
  constructor(private readonly rules: AlertRulesService) {}

  @Get()
  list() {
    return this.rules.list();
  }

  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Body() body: {
      name: string;
      ruleKind: AlertRuleKind;
      threshold: string | number;
      resourceId?: string;
      cylinderTypeId?: string;
      severity?: AlertSeverity;
      notes?: string;
    },
  ) {
    return this.rules.create({ ...body, createdBy: user.userId });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.rules.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.rules.remove(id);
  }

  // Manual "evaluate now" trigger — useful when the operator wants to see
  // what fires right now without waiting for the next page-load.
  @Post('evaluate')
  evaluate() {
    return this.rules.evaluateAll().then((raised) => ({ raised }));
  }
}
