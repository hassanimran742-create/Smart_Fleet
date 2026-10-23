import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { OrderDto } from '@smartfleet/shared-types';
import { formatWhenText } from '../../../i18n';
import { colors, Icon, layout, resolveStatus, sizes, space, StatusChip, Text } from '../../../ui';
import { feeText, itemsText } from './format';

/**
 * One order in My orders (UX_MOBILE S10): the customer's name, "AG-0142 · 2 × 11.8 kg · Today,
 * 4:12 pm", the stage chip and the fee chip ("Rs 330 paid"). At least 64 dp; the chips wrap under the
 * text at large font sizes.
 */
export function OrderRow({ order, onPress }: { order: OrderDto; onPress: () => void }) {
  const { t } = useTranslation();
  const subtitle = t('orders.list.subtitle', {
    code: order.shortCode,
    items: itemsText(order.lines, t),
    when: formatWhenText(order.createdAt),
  });
  const stage = resolveStatus('order', order.stage, t);
  const fee = resolveStatus('fee', order.fee.status, t, { fee: feeText(order.fee.totalPaisa) });
  const spoken = [order.client.name, subtitle, stage?.label, fee?.label].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.texts}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {order.client.name}
        </Text>
        <Text variant="caption" tone="secondary">
          {subtitle}
        </Text>
        <View style={styles.chips}>
          <StatusChip kind="order" value={order.stage} />
          <StatusChip kind="fee" value={order.fee.status} amountPaisa={order.fee.totalPaisa} />
        </View>
      </View>
      <Icon name="chevron" size={24} tone="secondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.canvas },
  texts: { flex: 1, gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
});
