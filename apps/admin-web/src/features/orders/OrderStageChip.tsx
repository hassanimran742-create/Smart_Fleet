import type { OrderDto } from '@smartfleet/shared-types';
import { StatusChip } from '../../ui';

/**
 * An order's stage chip (UX_PRINCIPLES §4.2): while LOADING with its trip's load known, the count after
 * "·" ("Loading · 3 of 5 loaded", `OrderDto.load`); every other stage is the plain `order` chip.
 */
export function OrderStageChip({ order }: { order: Pick<OrderDto, 'stage' | 'load'> }) {
  if (order.stage === 'LOADING' && order.load && order.load.total > 0) {
    return <StatusChip kind="orderProgress" value="LOADING" params={{ done: order.load.done, total: order.load.total }} />;
  }
  return <StatusChip kind="order" value={order.stage} />;
}
