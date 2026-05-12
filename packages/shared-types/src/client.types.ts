import type { Address, UUID } from './common.types';

export interface Client {
  id: UUID;
  distributorId: UUID;
  name: string;
  phone: string;
  addresses: Address[];
}
