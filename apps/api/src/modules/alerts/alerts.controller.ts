import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { AlertSeverity, AlertStatus, UserRole } from '@prisma/client';

@Controller('alerts')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Query('status') status?: AlertStatus, @Query('severity') severity?: AlertSeverity) {
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
