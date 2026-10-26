import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AnySettingRow, PublicAppConfig } from '@smartfleet/shared-types';
import { patchSettingSchema, type PatchSettingInput } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { SkipVersionGate } from '../../common/interceptors/app-version.interceptor';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { SettingsService } from './settings.service';

/** Office settings (API_CONTRACT §7.13). */
@Controller('settings')
@ExactRoles(UserRole.SUPER_ADMIN)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): Promise<AnySettingRow[]> {
    return this.settings.list();
  }

  /** `{ value, reason (5–300) }` → the updated row. SETTING_UNKNOWN, SETTING_NOT_EDITABLE, SETTING_INVALID_VALUE. */
  @Patch(':key')
  async update(
    @Param('key') key: string,
    @Body(new ZodBody(patchSettingSchema)) body: PatchSettingInput,
    @CurrentActor() actor: UserActor,
  ): Promise<AnySettingRow> {
    return this.settings.update(key, body.value, actor, body.reason);
  }
}

/** `GET /app/config` (API_CONTRACT §6): public, so the update gate runs before sign-in. */
@Controller('app')
export class AppConfigController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @SkipVersionGate()
  @Get('config')
  config(): Promise<PublicAppConfig> {
    return this.settings.publicConfig();
  }
}
