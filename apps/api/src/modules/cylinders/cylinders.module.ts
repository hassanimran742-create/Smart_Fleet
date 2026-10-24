import { Module } from '@nestjs/common';
import { CustodyModule } from '../custody/custody.module';
import { CylindersController } from './cylinders.controller';
import { CylindersService } from './cylinders.service';

/** Cylinders: registration and lookups; the holder history and the REGISTERED moves come from custody. */
@Module({
  imports: [CustodyModule],
  controllers: [CylindersController],
  providers: [CylindersService],
  exports: [CylindersService],
})
export class CylindersModule {}
