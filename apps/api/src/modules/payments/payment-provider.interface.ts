export interface InitTopupArgs {
  paymentId: string;
  amountPaisa: bigint;
  distributorId: string;
  description?: string;
}

export interface InitTopupResult {
  redirectUrl?: string;
  formFields?: Record<string, string>;
  endpointUrl?: string;
}

export interface PaymentProvider {
  name: 'JAZZCASH' | 'EASYPAISA' | 'BANK_MANUAL';
  init(args: InitTopupArgs): Promise<InitTopupResult>;
  verifyWebhook(payload: any): Promise<{
    providerTxnId: string;
    success: boolean;
    raw: any;
  }>;
}
