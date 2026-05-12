import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  InitTopupArgs,
  InitTopupResult,
  PaymentProvider,
} from '../payment-provider.interface';

@Injectable()
export class JazzCashProvider implements PaymentProvider {
  name = 'JAZZCASH' as const;
  private merchantId: string;
  private password: string;
  private integritySalt: string;
  private returnUrl: string;

  constructor(cfg: ConfigService) {
    this.merchantId = cfg.get<string>('payments.jazzcash.merchantId') ?? '';
    this.password = cfg.get<string>('payments.jazzcash.password') ?? '';
    this.integritySalt = cfg.get<string>('payments.jazzcash.integritySalt') ?? '';
    this.returnUrl = cfg.get<string>('payments.jazzcash.returnUrl') ?? '';
  }

  async init(args: InitTopupArgs): Promise<InitTopupResult> {
    const now = new Date();
    const expiry = new Date(now.getTime() + 60 * 60 * 1000);
    const stamp = (d: Date) =>
      d.toISOString().replace(/[-T:Z.]/g, '').slice(0, 14);
    const fields: Record<string, string> = {
      pp_Version: '1.1',
      pp_TxnType: 'MWALLET',
      pp_Language: 'EN',
      pp_MerchantID: this.merchantId,
      pp_Password: this.password,
      pp_TxnRefNo: args.paymentId,
      pp_Amount: String(args.amountPaisa),
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: stamp(now),
      pp_TxnExpiryDateTime: stamp(expiry),
      pp_BillReference: `top-${args.paymentId.slice(0, 8)}`,
      pp_Description: args.description ?? 'Smart_Fleet advance top-up',
      pp_ReturnURL: this.returnUrl,
      ppmpf_1: args.distributorId,
    };
    fields.pp_SecureHash = this.signFields(fields);
    return {
      endpointUrl: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
      formFields: fields,
    };
  }

  async verifyWebhook(payload: any) {
    const incomingHash = payload.pp_SecureHash;
    const { pp_SecureHash: _ignored, ...rest } = payload;
    const computed = this.signFields(rest);
    if (incomingHash !== computed) {
      return { providerTxnId: payload.pp_TxnRefNo, success: false, raw: payload };
    }
    const success = payload.pp_ResponseCode === '000';
    return { providerTxnId: payload.pp_TxnRefNo, success, raw: payload };
  }

  private signFields(fields: Record<string, string>) {
    const keys = Object.keys(fields)
      .filter((k) => k.startsWith('pp_') && fields[k] !== '' && fields[k] != null)
      .sort();
    const concat = this.integritySalt + '&' + keys.map((k) => fields[k]).join('&');
    return crypto.createHmac('sha256', this.integritySalt).update(concat).digest('hex').toUpperCase();
  }
}
