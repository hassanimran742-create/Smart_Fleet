import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SupportService } from './support.service';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { TicketStatus } from '@prisma/client';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.support.create({ ...body, reporterUserId: user.userId });
  }

  @Get()
  list(@Query('status') status?: TicketStatus) {
    return this.support.list(status);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: TicketStatus) {
    return this.support.setStatus(id, status);
  }
}
