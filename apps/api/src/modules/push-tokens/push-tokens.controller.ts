import { Body, Controller, Delete, Post } from '@nestjs/common';
import { PushTokensService } from './push-tokens.service';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';

@Controller('push-tokens')
export class PushTokensController {
  constructor(private readonly tokens: PushTokensService) {}

  @Post()
  register(@CurrentUser() user: AuthContext, @Body() body: { token: string; platform?: string }) {
    return this.tokens.upsert(user.userId, body.token, body.platform);
  }

  @Delete()
  unregister(@Body() body: { token: string }) {
    return this.tokens.removeByToken(body.token);
  }
}
