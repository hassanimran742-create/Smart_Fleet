import { Global, Module } from '@nestjs/common';
import { PushTokensController } from './push-tokens.controller';
import { PushTokensService } from './push-tokens.service';

@Global()
@Module({
  controllers: [PushTokensController],
  providers: [PushTokensService],
  exports: [PushTokensService],
})
export class PushTokensModule {}
