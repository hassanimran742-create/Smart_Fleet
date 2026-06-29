import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { PaymentProviderName, PaymentStatus, UserRole } from '@prisma/client';

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

  // Distributor's own top-up history.
  @Roles(UserRole.DISTRIBUTOR)
  @Get('mine')
  mine(@CurrentUser() user: AuthContext) {
    return this.payments.listForDistributor(user.distributorId!);
  }

  // Admin verification queue. ?status=PENDING by default in the UI.
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get()
  list(@Query('status') status?: PaymentStatus) {
    return this.payments.listForAdmin({ status });
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

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCHER)
  @Post(':id/verify')
  verify(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body('approve') approve: boolean,
  ) {
    return this.payments.verifyBankPayment(id, user.userId, approve);
  }
}
