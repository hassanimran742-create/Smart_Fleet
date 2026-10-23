import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CnicVault } from './cnic-vault.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** Users, the office's account controls and CNIC storage (`CnicVault`, also used for drivers). */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, CnicVault],
  exports: [UsersService, CnicVault],
})
export class UsersModule {}
