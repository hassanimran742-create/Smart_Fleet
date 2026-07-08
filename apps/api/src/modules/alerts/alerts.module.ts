import { Global, Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertRulesController } from './alert-rules.controller';
import { AlertRulesService } from './alert-rules.service';

@Global()
@Module({
  controllers: [AlertsController, AlertRulesController],
  providers: [AlertsService, AlertRulesService],
  exports: [AlertsService, AlertRulesService],
})
export class AlertsModule {}
