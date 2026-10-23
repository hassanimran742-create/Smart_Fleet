import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  createAlertRuleSchema,
  updateAlertRuleSchema,
  type CreateAlertRuleInput,
  type UpdateAlertRuleInput,
} from '@smartfleet/shared-validation';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { AlertRulesService } from './alert-rules.service';

/** Office alert rules (API_CONTRACT §7.2: office exact; "credit over" rules are retired). */
@Controller('alert-rules')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AlertRulesController {
  constructor(private readonly rules: AlertRulesService) {}

  @Get()
  list() {
    return this.rules.list();
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body(new ZodBody(createAlertRuleSchema)) body: CreateAlertRuleInput) {
    return this.rules.create(body, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodBody(updateAlertRuleSchema)) body: UpdateAlertRuleInput) {
    return this.rules.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.rules.remove(id);
  }

  /** "Evaluate now": what fires right now, without opening the alerts list. */
  @Post('evaluate')
  @HttpCode(200)
  async evaluate() {
    return { raised: await this.rules.evaluateAll() };
  }
}
