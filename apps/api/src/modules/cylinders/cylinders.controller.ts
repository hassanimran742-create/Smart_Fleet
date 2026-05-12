import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CylindersService } from './cylinders.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('cylinders')
export class CylindersController {
  constructor(private readonly cylinders: CylindersService) {}

  @Get('by-qr/:qr')
  byQr(@Param('qr') qr: string) {
    return this.cylinders.findByQr(qr);
  }

  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER)
  @Get()
  list(@Query('distributorId') distributorId?: string) {
    return this.cylinders.list(distributorId);
  }

  @Roles(UserRole.ADMIN)
  @Post('bulk-register')
  bulkRegister(@Body() body: any) {
    return this.cylinders.bulkRegister(body);
  }
}
