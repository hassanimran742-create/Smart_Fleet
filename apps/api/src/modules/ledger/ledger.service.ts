import { Injectable } from '@nestjs/common';
import type { LedgerBalanceDto } from '@smartfleet/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

/** How many rows `GET /ledger/me` returns (the installed LedgerScreen shows them all). */
export const LEDGER_ME_LIMIT = 100;

/** One row of `GET /ledger/me`: the ledger row without office-only fields (notes, keys, authors). */
export interface LedgerRowDto {
  id: string;
  distributorId: string;
  entryType: string;
  /** Signed digit string. */
  amountPaisa: string;
  balanceAfterPaisa: string;
  paymentId: string | null;
  orderId: string | null;
  reasonCode: string | null;
  createdAt: string;
}

/**
 * Compatibility for the installed 0.1.0 shop app (API_CONTRACT §5.1, Appendix A): a read-only façade
 * over the wallet. It owns no table and never moves money; the old unguarded order debit is gone
 * (WalletService.debit replaces it).
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  /** `GET /ledger/balance`: `{ balancePaisa, pendingTopupPaisa }`, nothing more. */
  async balanceOf(distributorId: string): Promise<LedgerBalanceDto> {
    const summary = await this.wallet.summary(distributorId);
    return { balancePaisa: summary.balancePaisa, pendingTopupPaisa: summary.pendingTopupPaisa };
  }

  /** `GET /ledger/me`: the distributor's newest 100 ledger rows, a bare array. */
  async listForDistributor(distributorId: string): Promise<LedgerRowDto[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { distributorId },
      select: {
        id: true,
        distributorId: true,
        entryType: true,
        amountPaisa: true,
        balanceAfterPaisa: true,
        paymentId: true,
        orderId: true,
        reasonCode: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LEDGER_ME_LIMIT,
    });
    return rows.map((row) => ({
      ...row,
      amountPaisa: row.amountPaisa.toString(),
      balanceAfterPaisa: row.balanceAfterPaisa.toString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
