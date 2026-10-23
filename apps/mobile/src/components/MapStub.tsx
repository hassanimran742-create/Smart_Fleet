import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, Icon, ltr, radius, space, Text } from '../ui';

/**
 * A stand-in for react-native-maps, for a build whose binary can't show the native map (an APK built
 * without the Google Maps key crashes on MapView). It has the same names (default `MapView`, `Marker`,
 * `animateToRegion`), so a screen switches with one import line. The shop screens use the real map,
 * which the 0.1.0 distributor APK carries; nothing imports this file today.
 */

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
}

export interface MapViewProps {
  initialRegion?: Region;
  region?: Region;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  children?: ReactNode;
}

/** What a ref to the map offers: the same call as react-native-maps, doing nothing here. */
export interface MapViewHandle {
  animateToRegion: (region: Region, duration?: number) => void;
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView({ style, children }, ref) {
  const { t } = useTranslation();
  useImperativeHandle(ref, () => ({ animateToRegion: () => undefined }), []);
  return (
    <View style={[styles.card, style]}>
      <Icon name="map" size={32} tone="secondary" />
      <Text variant="bodyStrong" align="center">
        {t('customers.map.unavailable')}
      </Text>
      <Text variant="caption" tone="secondary" align="center">
        {t('customers.map.unavailableBody')}
      </Text>
      {children}
    </View>
  );
});

export default MapView;

export interface MarkerProps {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  description?: string;
}

/** The chosen spot as text: "Delivery spot · 31.5204, 74.3587". */
export function Marker({ coordinate, title }: MarkerProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.marker}>
      <Icon name="map" size={20} tone="onBrand" />
      <Text variant="label" tone="onBrand">
        {t('customers.map.selected', {
          label: title ?? t('customers.map.selectedDefault'),
          lat: ltr(coordinate.latitude.toFixed(4)),
          lng: ltr(coordinate.longitude.toFixed(4)),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 160,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.sunken,
    padding: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  marker: {
    marginTop: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'center',
  },
});
