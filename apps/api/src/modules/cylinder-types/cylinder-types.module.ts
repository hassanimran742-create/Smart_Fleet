import { Module } from '@nestjs/common';
import { CylinderTypesController } from './cylinder-types.controller';
import { CylinderTypesService } from './cylinder-types.service';

@Module({
  controllers: [CylinderTypesController],
  providers: [CylinderTypesService],
  exports: [CylinderTypesService],
})
export class CylinderTypesModule {}
