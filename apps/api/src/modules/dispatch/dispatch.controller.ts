import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { manualDispatchSchema, type ManualDispatchInput } from '@smartfleet/shared-validation';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { DispatchService, type DispatchOutcome } from './dispatch.service';

@Controller('dispatch')
@ExactRoles(UserRole.SUPER_ADMIN)
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  /** 403 DISPATCH_AUTO_OFF while automatic assignment is switched off (the pilot default). */
  @Post('manual')
  @HttpCode(200)
  /** `POST /dispatch/manual { orderId }` (legacy office button). */
  manualDispatch(@Body(new ZodBody(manualDispatchSchema)) body: ManualDispatchInput): Promise<DispatchOutcome> {
    return this.dispatch.manual(body.orderId);
  }
}
