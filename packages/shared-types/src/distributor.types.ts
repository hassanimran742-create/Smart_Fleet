import type { Paisa, UUID } from './common.types';

export interface Distributor {
  id: UUID;
  userId: UUID;
  businessName: string;
  homeStoreId: UUID;
  advanceBalancePaisa: Paisa;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
}
