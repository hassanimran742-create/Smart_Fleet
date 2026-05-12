import { Body, Controller, Param, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { PaymentProviderName, UserRole } from '@prisma/client';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN)
  @Post('topup')
  topup(
    @CurrentUser() user: AuthContext,
    @Body() body: { amountPaisa: number; provider: PaymentProviderName },
  ) {
    return this.payments.initTopup({
      distributorId: user.distributorId!,
      amountPaisa: BigInt(body.amountPaisa),
      provider: body.provider,
    });
  }

  @Public()
  @Post('webhook/:provider')
  webhook(@Param('provider') provider: PaymentProviderName, @Body() payload: any) {
    return this.payments.handleWebhook(provider, payload);
  }

  @Roles(UserRole.DISTRIBUTOR)
  @Post(':id/bank-proof')
  bankProof(@Param('id') id: string, @Body('proofUrl') proofUrl: string) {
    return this.payments.submitBankProof(id, proofUrl);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @Post(':id/verify')
  verify(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body('approve') approve: boolean,
  ) {
    return this.payments.verifyBankPayment(id, user.userId, approve);
  }
}
