import type { UUID } from './common.types';
import type { CustodyType, CylinderState } from './cylinder.types';

export interface InventoryLot {
  id: UUID;
  holderType: CustodyType;
  holderId: UUID;
  distributorId: UUID;
  cylinderTypeId: UUID;
  state: CylinderState;
  count: number;
}
