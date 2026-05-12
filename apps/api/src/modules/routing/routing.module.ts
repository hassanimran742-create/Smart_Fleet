import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROUTING_PROVIDER, RoutingService } from './routing.service';
import { GoogleRoutingProvider } from './providers/google-routing.provider';

@Global()
@Module({
  providers: [
    GoogleRoutingProvider,
    {
      provide: ROUTING_PROVIDER,
      inject: [ConfigService, GoogleRoutingProvider],
      useFactory: (cfg: ConfigService, google: GoogleRoutingProvider) => {
        const provider = cfg.get<string>('routing.provider');
        switch (provider) {
          case 'google':
          default:
            return google;
        }
      },
    },
    RoutingService,
  ],
  exports: [RoutingService],
})
export class RoutingModule {}
