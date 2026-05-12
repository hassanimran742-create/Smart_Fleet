import { Inject, Injectable } from '@nestjs/common';
import { RoutingProvider } from './routing-provider.interface';

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

@Injectable()
export class RoutingService {
  constructor(@Inject(ROUTING_PROVIDER) private provider: RoutingProvider) {}

  matrix = this.provider.matrix.bind(this.provider);
  route = this.provider.route.bind(this.provider);
}
