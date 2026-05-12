import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { JazzCashProvider } from './providers/jazzcash.provider';
import { EasypaisaProvider } from './providers/easypaisa.provider';
import { BankManualProvider } from './providers/bank-manual.provider';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, JazzCashProvider, EasypaisaProvider, BankManualProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
