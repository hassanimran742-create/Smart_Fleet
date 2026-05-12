import { Body, Controller, Post } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('dispatch')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Post('manual')
  manualDispatch(@Body('orderId') orderId: string) {
    return this.dispatch.dispatchOrder(orderId);
  }
}
