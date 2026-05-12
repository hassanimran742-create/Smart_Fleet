import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  InitTopupArgs,
  InitTopupResult,
  PaymentProvider,
} from '../payment-provider.interface';

@Injectable()
export class EasypaisaProvider implements PaymentProvider {
  name = 'EASYPAISA' as const;
  private storeId: string;
  private hashKey: string;
  private returnUrl: string;

  constructor(cfg: ConfigService) {
    this.storeId = cfg.get<string>('payments.easypaisa.storeId') ?? '';
    this.hashKey = cfg.get<string>('payments.easypaisa.hashKey') ?? '';
    this.returnUrl = cfg.get<string>('payments.easypaisa.returnUrl') ?? '';
  }

  async init(args: InitTopupArgs): Promise<InitTopupResult> {
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    const fields: Record<string, string> = {
      storeId: this.storeId,
      orderRefNum: args.paymentId,
      amount: (Number(args.amountPaisa) / 100).toFixed(2),
      paymentMethod: 'MA_PAYMENT_METHOD',
      postBackURL: this.returnUrl,
      orderExpireDate: expiry.toISOString(),
    };
    fields.merchantHashedReq = this.signFields(fields);
    return {
      endpointUrl: 'https://easypay.easypaisa.com.pk/easypay/Index.jsf',
      formFields: fields,
    };
  }

  async verifyWebhook(payload: any) {
    const incoming = payload.merchantHashedReq;
    const { merchantHashedReq: _ignored, ...rest } = payload;
    const computed = this.signFields(rest);
    if (incoming !== computed) {
      return { providerTxnId: payload.orderRefNum, success: false, raw: payload };
    }
    const success = payload.status === 'SUCCESS';
    return { providerTxnId: payload.orderRefNum, success, raw: payload };
  }

  private signFields(fields: Record<string, string>) {
    const ordered = Object.keys(fields)
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('&');
    return crypto.createHmac('sha256', this.hashKey).update(ordered).digest('hex').toUpperCase();
  }
}
