import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import {
  registerPushTokenSchema,
  removePushTokenSchema,
  type RegisterPushTokenInput,
  type RemovePushTokenInput,
} from '@smartfleet/shared-validation';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { PushTokensService } from './push-tokens.service';

/** Any signed-in user, for their own phone only (API_CONTRACT §7.2). */
@Controller('push-tokens')
export class PushTokensController {
  constructor(private readonly tokens: PushTokensService) {}

  @Post()
  @HttpCode(200)
  register(@CurrentUser() user: AuthContext, @Body(new ZodBody(registerPushTokenSchema)) body: RegisterPushTokenInput) {
    return this.tokens.register(user.userId, body.token, body.platform);
  }

  @Delete()
  unregister(@CurrentUser() user: AuthContext, @Body(new ZodBody(removePushTokenSchema)) body: RemovePushTokenInput) {
    return this.tokens.remove(user.userId, body.token);
  }
}
