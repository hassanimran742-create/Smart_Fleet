import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';

@Controller('custody')
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}

  @Post('scan')
  scan(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.custody.scan({ ...body, actorUserId: user.userId });
  }

  @Get('cylinders/:id/history')
  history(@Param('id') id: string) {
    return this.custody.history(id);
  }
}
