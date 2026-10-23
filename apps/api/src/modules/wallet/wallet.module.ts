import { Module } from '@nestjs/common';
import { AdminWalletsController } from './admin-wallets.controller';
import { WalletAdminService } from './wallet-admin.service';
import { WalletCheckJob } from './wallet-check.job';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Money (API_CONTRACT §5.1): only this module writes `distributors.advance_balance_paisa` and
 * `ledger_entries`. Not global on purpose: modules that move money import it explicitly, and
 * ExpensesModule never does (ADR-14). It also serves the wallet routes (§7.8) and runs the nightly
 * wallet check (§8.5).
 */
@Module({
  controllers: [WalletController, AdminWalletsController],
  providers: [WalletService, WalletAdminService, WalletCheckJob],
  exports: [WalletService],
})
export class WalletModule {}
