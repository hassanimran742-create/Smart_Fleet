import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { TransferStatus, UserRole } from '@prisma/client';

@Controller('transfers')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  list() {
    return this.transfers.list();
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.transfers.create({ ...body, requestedBy: user.userId });
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: TransferStatus) {
    return this.transfers.setStatus(id, status);
  }
}
