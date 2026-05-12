import type { ISODateString, Paisa, UUID } from './common.types';

export enum PaymentProviderName {
  JAZZCASH = 'JAZZCASH',
  EASYPAISA = 'EASYPAISA',
  BANK_MANUAL = 'BANK_MANUAL',
  CASH = 'CASH',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export interface Payment {
  id: UUID;
  distributorId: UUID;
  amountPaisa: Paisa;
  provider: PaymentProviderName;
  providerTxnId: string;
  status: PaymentStatus;
  proofUrl?: string;
  verifiedByUserId?: UUID;
  createdAt: ISODateString;
  completedAt?: ISODateString;
}

export interface InitiateTopupRequest {
  distributorId: UUID;
  amountPaisa: Paisa;
  provider: PaymentProviderName;
}

export interface InitiateTopupResponse {
  paymentId: UUID;
  redirectUrl?: string;
  formFields?: Record<string, string>;
}
