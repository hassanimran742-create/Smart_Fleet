import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { QueueErrorLog } from './logging/queue-error-log';
import { RateLimitService } from './rate-limit/rate-limit.service';

/**
 * Global providers behind the common decorators. `@RateLimit` and `@Feature` attach their guards
 * per route, and those guards resolve `RateLimitService` and `SettingsService` from here and from
 * the global SettingsModule, so feature modules import nothing to use them. `QueueErrorLog` gives
 * every BullMQ queue and worker a throttled error listener (API_CONTRACT §3.6).
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [RateLimitService, QueueErrorLog],
  exports: [RateLimitService],
})
export class CommonModule {}
