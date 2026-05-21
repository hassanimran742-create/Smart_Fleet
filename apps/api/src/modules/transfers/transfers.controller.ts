import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { TransferStatus, UserRole } from '@prisma/client';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  // Driver app: list scheduled transfers assigned to me. Must be declared
  // before the @Get() admin list so the route order isn't ambiguous.
  @Get('mine')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  mine(@CurrentUser() user: AuthContext) {
    if (!user.driverId) throw new BadRequestException('Not signed in as a driver');
    return this.transfers.listForDriver(user.driverId);
  }

  @Get('stock/:storeId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  stock(@Param('storeId') storeId: string) {
    return this.transfers.stockSummary(storeId);
  }

  // Driver and admin both need full detail. Auth-wise we just require the
  // driver to be the assigned driver — handled inline.
  @Get(':id')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  async byId(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const t = await this.transfers.byId(id);
    if (user.role === 'DRIVER' && t.driverId !== user.driverId) {
      throw new BadRequestException('This transfer is not assigned to you.');
    }
    return t;
  }

  @Get(':id/progress')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER)
  progress(@Param('id') id: string) {
    return this.transfers.progress(id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  list() {
    return this.transfers.list();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  create(@CurrentUser() user: AuthContext, @Body() body: any) {
    return this.transfers.create({ ...body, requestedBy: user.userId });
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER, UserRole.DRIVER)
  setStatus(@Param('id') id: string, @Body('status') status: TransferStatus) {
    return this.transfers.setStatus(id, status);
  }

  // Driver-app scan endpoint. The mobile screen passes the phase
  // (PICKUP / DROPOFF) and the scanned QR code; the service figures out
  // the rest (source/destination custody, allowed transition, status advance).
  @Post(':id/scan')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  scan(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { qrCode: string; phase: 'PICKUP' | 'DROPOFF'; lat?: number; lng?: number },
  ) {
    if (!user.driverId) throw new BadRequestException('Only drivers can scan transfer cylinders.');
    return this.transfers.scanForDriver({
      transferId: id,
      qrCode: body.qrCode,
      phase: body.phase,
      actorUserId: user.userId,
      driverId: user.driverId,
      lat: body.lat,
      lng: body.lng,
    });
  }
}
