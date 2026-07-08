import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertRulesService } from './alert-rules.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { AlertSeverity, AlertStatus, UserRole } from '@prisma/client';

@Controller('alerts')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER)
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly rules: AlertRulesService,
  ) {}

  // Re-evaluate user-defined rules every time the list is loaded so the operator
  // sees current state without needing a separate worker. The evaluation is dedup-ed
  // and bounded by the (small) number of rules, so cost is low for v1.
  @Get()
  async list(@Query('status') status?: AlertStatus, @Query('severity') severity?: AlertSeverity) {
    await this.rules.evaluateAll();
    return this.alerts.list({ status, severity });
  }

  @Get('unread-count')
  unread() {
    return this.alerts.unreadCount().then((count) => ({ count }));
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
