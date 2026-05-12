import { Inject, Injectable } from '@nestjs/common';
import { RoutingProvider } from './routing-provider.interface';

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

@Injectable()
export class RoutingService {
  constructor(@Inject(ROUTING_PROVIDER) private provider: RoutingProvider) {}

  matrix(
    origins: Array<{ lat: number; lng: number }>,
    destinations: Array<{ lat: number; lng: number }>,
  ) {
    return this.provider.matrix(origins, destinations);
  }

  route(waypoints: Array<{ lat: number; lng: number }>) {
    return this.provider.route(waypoints);
  }
}
