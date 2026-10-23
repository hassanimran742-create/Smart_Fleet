import { Global, Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertRulesController } from './alert-rules.controller';
import { AlertRulesService } from './alert-rules.service';
import { CasesService } from './cases.service';

/**
 * The office alerts and alert rules (Inc 1), and the customer-problem cases (Inc 2, API_CONTRACT §9.6).
 * Global, so the wallet check, the van check and the customer confirmation raise alerts without imports.
 */
@Global()
@Module({
  controllers: [AlertsController, AlertRulesController],
  providers: [AlertsService, AlertRulesService, CasesService],
  exports: [AlertsService, AlertRulesService, CasesService],
})
export class AlertsModule {}
