import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

/** A read-only compatibility façade over the wallet (API_CONTRACT §5.1): it owns no table. */
@Module({
  imports: [WalletModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
