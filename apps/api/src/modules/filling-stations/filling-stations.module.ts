import { Module } from '@nestjs/common';
import { FillingStationsController } from './filling-stations.controller';
import { FillingStationsService } from './filling-stations.service';

@Module({
  controllers: [FillingStationsController],
  providers: [FillingStationsService],
  exports: [FillingStationsService],
})
export class FillingStationsModule {}
