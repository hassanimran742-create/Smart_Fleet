import { useTranslation } from 'react-i18next';
import type { OrderDto } from '@smartfleet/shared-types';
import { whenTranslate } from '../../../i18n';
import { ListRow, resolveStatus, StatusChip, Text } from '../../../ui';
import { feeText, isPositivePaisa, itemsText, rowTime } from './format';

/**
 * The money chip of a cancelled order (shop spec §S): "Rs 400 returned" when the cost came back, "No
 * refund" when it was taken and kept. Active and delivered rows have none: the cost is on the order.
 */
function cancelMoney(order: OrderDto): 'returned' | 'noRefund' | null {
  if (order.stage !== 'CANCELLED') return null;
  if (order.fee.status === 'REVERSED') return 'returned';
  if (order.fee.status === 'DEDUCTED' && isPositivePaisa(order.fee.totalPaisa)) return 'noRefund';
  return null;
}

/**
 * One order (UX_MOBILE S10; shop spec §S), WhatsApp-like: the customer's name in bold, the grey line
 * "2 × 11.8 kg · AG-0142", the time on the right, and the stage chip under the grey line (with the
 * money chip on a cancelled order). Used by My orders and Home's active rows.
 */
export function OrderRow({ order, onPress }: { order: OrderDto; onPress: () => void }) {
  const { t } = useTranslation();
  const subtitle = t('orders.list.subtitle', { items: itemsText(order.lines, t), code: order.shortCode });
  const time = rowTime(order.createdAt, whenTranslate);
  const stage = resolveStatus('order', order.stage, t);
  const money = cancelMoney(order);
  const moneyLabel =
    money === 'returned'
      ? resolveStatus('fee', 'REVERSED', t, { fee: feeText(order.fee.totalPaisa) })?.label
      : money === 'noRefund'
        ? t('orders.list.noRefund')
        : undefined;
  const spoken = [order.client.name, subtitle, time, stage?.label ?? t('stages.unknown'), moneyLabel]
    .filter(Boolean)
    .join(', ');

  return (
    <ListRow
      title={order.client.name}
      subtitle={subtitle}
      onPress={onPress}
      chevron
      accessibilityLabel={spoken}
      trailing={
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {time}
        </Text>
      }
      below={
        <>
          <StatusChip kind="order" value={order.stage} />
          {money === 'returned' ? (
            <StatusChip kind="fee" value="REVERSED" amountPaisa={order.fee.totalPaisa} />
          ) : money === 'noRefund' ? (
            <StatusChip tone="neutral" label={t('orders.list.noRefund')} />
          ) : null}
        </>
      }
    />
  );
}
