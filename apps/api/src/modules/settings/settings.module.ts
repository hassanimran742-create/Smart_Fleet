import { Global, Module } from '@nestjs/common';
import { AppConfigController, SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Runtime settings (API_CONTRACT §5.2, §6). Global: any module reads `SettingsService.get(key)`.
 * Only this module writes `app_settings`.
 */
@Global()
@Module({
  controllers: [SettingsController, AppConfigController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
