import type { TopupAccount } from '@smartfleet/shared-types';

/**
 * How money reaches the company (API_CONTRACT §5.7, ADR-20). Nothing outside a provider knows which
 * one is live.
 * - MANUAL_REVIEW (the pilot's manual bank top-up): the distributor pays the company account, then the
 *   office approves the request against the company bank app.
 * - GATEWAY (Easypaisa later): `initiate`, then a verified callback, and `inquire` always before a credit.
 * Every credit, whichever the provider, goes through TopupService and WalletService.creditTopup.
 */
export type PaymentProviderKind = 'MANUAL_REVIEW' | 'GATEWAY';

export type PaymentProviderCode = 'BANK_MANUAL' | 'EASYPAISA' | 'JAZZCASH';

/** What the distributor needs to pay a manual top-up. */
export interface PaymentInstructions {
  account: TopupAccount;
  /** The plain-English steps the installed 0.1.0 app shows as `formFields.instructions`. */
  text: string;
}

export type GatewayOutcome = 'PAID' | 'FAILED' | 'PENDING';

export interface PaymentProvider {
  readonly name: PaymentProviderCode;
  readonly kind: PaymentProviderKind;
  /** Whether new top-ups may use it now. */
  enabled(): Promise<boolean>;
  /** MANUAL_REVIEW: where to pay. `reference` is the request's short code (AG-T031). */
  instructions?(ctx: { distributorId: string; amountPaisa?: bigint; reference?: string }): Promise<PaymentInstructions>;
  /** GATEWAY (later): starts a payment. */
  initiate?(p: { paymentId: string; amountPaisa: bigint; distributorId: string }): Promise<{
    redirectUrl?: string;
    formFields?: Record<string, string>;
  }>;
  /** GATEWAY (later): reads a signed callback; never trusted without {@link inquire}. */
  verifyCallback?(req: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
    query: Record<string, unknown>;
  }): Promise<{ paymentId: string; providerTxnId: string; amountPaisa: bigint; outcome: GatewayOutcome }>;
  /** GATEWAY (later): asks the provider for the truth, always before a credit. */
  inquire?(p: { paymentId: string; providerTxnId: string }): Promise<{ outcome: GatewayOutcome; amountPaisa: bigint }>;
}
