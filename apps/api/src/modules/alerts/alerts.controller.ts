import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { alertsQuerySchema, type AlertsQuery } from '@smartfleet/shared-validation';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-body.pipe';
import { AlertRulesService } from './alert-rules.service';
import { AlertsService } from './alerts.service';

/** The legacy office alerts (API_CONTRACT §7.2: office exact). Customer-problem cases are never shown here. */
@Controller('alerts')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly rules: AlertRulesService,
  ) {}

  /** Re-evaluates the rules first, so the office always sees the current state (deduplicated). */
  @Get()
  async list(@Query(new ZodQuery(alertsQuerySchema)) query: AlertsQuery) {
    await this.rules.evaluateAll();
    return this.alerts.list(query);
  }

  @Get('unread-count')
  async unread() {
    return { count: await this.alerts.unreadCount() };
  }

  @Patch(':id/acknowledge')
  ack(@Param('id') id: string) {
    return this.alerts.acknowledge(id);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.alerts.resolve(id);
  }
}
