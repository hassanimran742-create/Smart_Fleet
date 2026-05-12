import type { ISODateString, Paisa, UUID } from './common.types';

export enum LedgerEntryType {
  CREDIT_TOPUP = 'CREDIT_TOPUP',
  DEBIT_ORDER = 'DEBIT_ORDER',
  ADJUSTMENT = 'ADJUSTMENT',
}

export interface LedgerEntry {
  id: UUID;
  distributorId: UUID;
  entryType: LedgerEntryType;
  amountPaisa: Paisa;
  balanceAfterPaisa: Paisa;
  paymentId?: UUID;
  orderId?: UUID;
  note?: string;
  createdAt: ISODateString;
}
