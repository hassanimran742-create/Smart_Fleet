import { Controller, Get, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Get('store/:id')
  forStore(@Param('id') id: string) {
    return this.inv.forStore(id);
  }

  @Get('distributor/:id')
  forDistributor(@Param('id') id: string) {
    return this.inv.forDistributor(id);
  }

  @Get('vehicle/:id')
  forVehicle(@Param('id') id: string) {
    return this.inv.forVehicle(id);
  }
}
