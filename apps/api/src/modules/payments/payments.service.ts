import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LedgerEntryType,
  PaymentProviderName,
  PaymentStatus,
} from '@prisma/client';
import { JazzCashProvider } from './providers/jazzcash.provider';
import { EasypaisaProvider } from './providers/easypaisa.provider';
import { BankManualProvider } from './providers/bank-manual.provider';
import { PaymentProvider } from './payment-provider.interface';
import { FilesService } from '../files/files.service';

@Injectable()
export class PaymentsService {
  private providers: Record<PaymentProviderName, PaymentProvider | null>;

  constructor(
    private prisma: PrismaService,
    private jazz: JazzCashProvider,
    private easy: EasypaisaProvider,
    private bank: BankManualProvider,
    private files: FilesService,
  ) {
    this.providers = {
      JAZZCASH: jazz,
      EASYPAISA: easy,
      BANK_MANUAL: bank,
      CASH: null,
    };
  }

  async initTopup(opts: {
    distributorId: string;
    amountPaisa: bigint;
    provider: PaymentProviderName;
  }) {
    const provider = this.providers[opts.provider];
    if (!provider) throw new BadRequestException(`Provider ${opts.provider} not supported for top-up`);
    const payment = await this.prisma.payment.create({
      data: {
        distributorId: opts.distributorId,
        amountPaisa: opts.amountPaisa,
        provider: opts.provider,
        providerTxnId: '', // filled after init or remains paymentId for sandbox
        status: PaymentStatus.PENDING,
      },
    });
    const initResult = await provider.init({
      paymentId: payment.id,
      amountPaisa: opts.amountPaisa,
      distributorId: opts.distributorId,
    });
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerTxnId: payment.id },
    });
    return { paymentId: payment.id, ...initResult };
  }

  async handleWebhook(providerName: PaymentProviderName, payload: any) {
    const provider = this.providers[providerName];
    if (!provider) throw new BadRequestException();
    const result = await provider.verifyWebhook(payload);
    if (!result.providerTxnId) throw new BadRequestException('Missing provider txn id');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { provider_providerTxnId: { provider: providerName, providerTxnId: result.providerTxnId } },
      });
      if (!payment) throw new NotFoundException();
      if (payment.status === PaymentStatus.SUCCESS) {
        return { idempotent: true, status: payment.status };
      }
      const newStatus = result.success ? PaymentStatus.SUCCESS : PaymentStatus.FAILED;
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: newStatus, completedAt: new Date() },
      });
      if (newStatus === PaymentStatus.SUCCESS) {
        await this.creditLedger(tx, payment.distributorId, payment.amountPaisa, payment.id);
      }
      return { status: newStatus };
    });
  }

  async submitBankProof(paymentId: string, proofUrl: string) {
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { proofUrl },
    });
  }

  // A distributor's own top-up history (newest first).
  async listForDistributor(distributorId: string) {
    const rows = await this.prisma.payment.findMany({
      where: { distributorId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.withSignedProofs(rows);
  }

  // Admin queue. Defaults to the payments that need a human decision:
  // bank-transfer top-ups that are still PENDING and have a proof uploaded.
  async listForAdmin(filter: { status?: PaymentStatus } = {}) {
    const rows = await this.prisma.payment.findMany({
      where: { status: filter.status },
      include: {
        distributor: { include: { user: { select: { name: true, phone: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return this.withSignedProofs(rows);
  }

  // Replace each stored proofUrl with a short-lived presigned URL so the slip
  // opens in the browser even though the bucket is private. Lists refetch
  // often enough that the ~10 min signature never goes stale in practice.
  private async withSignedProofs<T extends { proofUrl: string | null }>(rows: T[]): Promise<T[]> {
    return Promise.all(
      rows.map(async (r) => ({ ...r, proofUrl: await this.files.signStoredUrl(r.proofUrl) })),
    );
  }

  async verifyBankPayment(paymentId: string, verifiedByUserId: string, approve: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException();
      const status = approve ? PaymentStatus.SUCCESS : PaymentStatus.FAILED;
      await tx.payment.update({
        where: { id: paymentId },
        data: { status, completedAt: new Date(), verifiedByUserId },
      });
      if (approve) {
        await this.creditLedger(tx, payment.distributorId, payment.amountPaisa, payment.id);
      }
      return { status };
    });
  }

  private async creditLedger(
    tx: any,
    distributorId: string,
    amountPaisa: bigint,
    paymentId: string,
  ) {
    const distributor = await tx.distributor.findUnique({ where: { id: distributorId } });
    const newBalance = (distributor?.advanceBalancePaisa ?? 0n) + amountPaisa;
    await tx.distributor.update({
      where: { id: distributorId },
      data: { advanceBalancePaisa: newBalance },
    });
    await tx.ledgerEntry.create({
      data: {
        distributorId,
        entryType: LedgerEntryType.CREDIT_TOPUP,
        amountPaisa,
        balanceAfterPaisa: newBalance,
        paymentId,
      },
    });
  }
}
