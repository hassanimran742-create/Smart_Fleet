import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.clients.listForDistributor(user.distributorId!);
  }

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN)
  @Post()
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.clients.create(user.distributorId!, body);
  }

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN, UserRole.DISPATCHER)
  @Get(':id/addresses')
  addresses(@Param('id') id: string) {
    return this.clients.listAddresses(id);
  }

  @Roles(UserRole.DISTRIBUTOR, UserRole.ADMIN)
  @Post(':id/addresses')
  addAddress(@Param('id') id: string, @Body() body: any) {
    return this.clients.addAddress(id, body);
  }
}
