import { Module } from '@nestjs/common';
import { CylindersController } from './cylinders.controller';
import { CylindersService } from './cylinders.service';

@Module({
  controllers: [CylindersController],
  providers: [CylindersService],
  exports: [CylindersService],
})
export class CylindersModule {}
