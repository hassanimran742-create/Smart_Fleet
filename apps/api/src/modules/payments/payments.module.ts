import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { AdminTopupsController } from './admin-topups.controller';
import { PaymentsController } from './payments.controller';
import { BankManualProvider } from './providers/bank-manual.provider';
import { EasypaisaProvider } from './providers/easypaisa.provider';
import { JazzCashProvider } from './providers/jazzcash.provider';
import { TopupService } from './topup.service';

/**
 * Top-ups (API_CONTRACT §5.1, §5.7): owns `payments`; credits only through WalletService. The gateway
 * providers stay registered and switched off. `TopupService.approvedToday()` serves the office summary.
 */
@Module({
  imports: [WalletModule],
  controllers: [PaymentsController, AdminTopupsController],
  providers: [TopupService, BankManualProvider, EasypaisaProvider, JazzCashProvider],
  exports: [TopupService],
})
export class PaymentsModule {}
