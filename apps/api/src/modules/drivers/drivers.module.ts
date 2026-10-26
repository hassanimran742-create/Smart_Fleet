import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { DriversController } from './drivers.controller';
import { DriversGateway } from './drivers.gateway';
import { DriversService } from './drivers.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [DriversController],
  providers: [DriversService, DriversGateway],
  exports: [DriversService],
})
export class DriversModule {}
