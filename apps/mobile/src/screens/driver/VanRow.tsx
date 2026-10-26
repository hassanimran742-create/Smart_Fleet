import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import type { DriverHomeDto } from '@smartfleet/shared-types';
import { ListRow, colors, ltr, radius } from '../../ui';
import { vanCountsLine } from './tripModel';

/**
 * Today's van row (driver spec D4 and R2): the plate and what is on the van, "3 full · 1 empty · 1
 * part-filled" with the zeros hidden, or "No cylinders"; "No van yet." without one. A tap opens My van.
 * It reads `GET /driver/home`, the same answer as the trips under it.
 */
export function VanRow({ home, onPress }: { home: Pick<DriverHomeDto, 'vehicle' | 'van'>; onPress: () => void }) {
  const { t } = useTranslation();
  if (!home.vehicle) {
    return (
      <ListRow title={t('driver.van.none')} leadingIcon="van" chevron onPress={onPress} style={styles.row} testID="home.van" />
    );
  }
  const plate = ltr(home.vehicle.plateNo);
  const counts = vanCountsLine(home.van, t) || t('driver.van.noCylinders');
  return (
    <ListRow
      title={plate}
      subtitle={counts}
      leadingIcon="van"
      chevron
      onPress={onPress}
      accessibilityLabel={`${t('driver.van.plate', { plate })}, ${counts}`}
      style={styles.row}
      testID="home.van"
    />
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
});
