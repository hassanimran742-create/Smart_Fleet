import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TransferStatus, UserRole } from '@prisma/client';
import { AuthContext, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { Feature } from '../../common/features/feature';
import { TransfersService } from './transfers.service';

/**
 * Store-to-store transfers: switched off for the pilot (ADR-04, `features.transfers`), because they
 * are a second scan path outside the holder rules. While off, writes get 403 FEATURE_DISABLED and
 * lists `[]` with `X-Feature-Disabled: transfers`; the installed driver app polls `/transfers/mine`.
 */
@Feature('transfers')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  // Driver app: scheduled transfers assigned to me. Declared before `:id` so the routes don't clash.
  @Get('mine')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  mine(@CurrentUser() user: AuthContext) {
    if (!user.driverId) return [];
    return this.transfers.listForDriver(user.driverId);
  }

  @Get('stock/:storeId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  stock(@Param('storeId') storeId: string) {
    return this.transfers.stockSummary(storeId);
  }

  // A driver sees only a transfer assigned to them (another one is 404, API_CONTRACT §3.2).
  @Get(':id')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  async byId(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const t = await this.transfers.byId(id);
    if (user.role === UserRole.DRIVER && t.driverId !== user.driverId) throw new AppError('NOT_FOUND');
    return t;
  }

  @Get(':id/progress')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER)
  async progress(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const t = await this.transfers.byId(id);
    if (user.role === UserRole.DRIVER && t.driverId !== user.driverId) throw new AppError('NOT_FOUND');
    return this.transfers.progress(id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  list() {
    return this.transfers.list();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  create(
    @CurrentUser() user: AuthContext,
    @Body()
    body: {
      fromStoreId: string;
      toStoreId: string;
      cylinderIds: string[];
      vehicleId?: string;
      driverId?: string;
      scheduledFor?: string;
      notes?: string;
    },
  ) {
    return this.transfers.create({ ...body, requestedBy: user.userId });
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER, UserRole.DRIVER)
  setStatus(@Param('id') id: string, @Body('status') status: TransferStatus) {
    return this.transfers.setStatus(id, status);
  }

  // Driver-app scan: the phase (PICKUP / DROPOFF) and the scanned QR; the service derives the rest.
  @Post(':id/scan')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  scan(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { qrCode: string; phase: 'PICKUP' | 'DROPOFF'; lat?: number; lng?: number },
  ) {
    if (!user.driverId) throw new AppError('PERMISSION_DENIED');
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
