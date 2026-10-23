import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type MapPressEvent, type MarkerDragStartEndEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { Button, colors, Field, Icon, layout, radius, sizes, space, Text } from '../../../ui';
import { CostLine, roundPin, type CostPanelState, type Pin } from './CostPanel';
import { PLACE_SEARCH_MIN_LENGTH, searchPlaces, type PlaceResult } from './places';

/** Where the map opens when the shop's store isn't known yet: central Lahore. */
const FALLBACK_CENTER: Pin = { lat: 31.5204, lng: 74.3587 };
const MAP_HEIGHT = 240;
const SEARCH_DEBOUNCE_MS = 500;
const LOCATION_TIMEOUT_MS = 15_000;
/** How far the map zooms in on a pin. */
const PIN_DELTA = 0.005;
const AREA_DELTA = 0.05;

type LocateState = 'idle' | 'locating' | 'denied' | 'failed';

export interface LocationPickerProps {
  pin: Pin | null;
  onPinChange: (pin: Pin) => void;
  /** The shop's store, so the map opens where the shop is. */
  center?: Pin | null;
  costState: CostPanelState;
}

/**
 * The delivery spot (shop spec §M items 3–5; Add customer step 2 and New address): a search box, the
 * map with "Use my location" over its bottom-end corner (the location permission is asked on that
 * tap only), a pin to drop and drag, and one line under the map with the result. Typed fields (House
 * and street) sit on the form, not here.
 */
export function LocationPicker({ pin, onPinChange, center, costState }: LocationPickerProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'done' | 'failed'>('idle');
  const [locate, setLocate] = useState<LocateState>('idle');
  const start = pin ?? center ?? FALLBACK_CENTER;
  const [initialRegion] = useState(() => ({
    latitude: start.lat,
    longitude: start.lng,
    latitudeDelta: pin ? PIN_DELTA : AREA_DELTA,
    longitudeDelta: pin ? PIN_DELTA : AREA_DELTA,
  }));

  // The shop's store can arrive after the map opened: go there while no pin is dropped yet.
  const centerLat = center?.lat;
  const centerLng = center?.lng;
  const hasPin = pin !== null;
  useEffect(() => {
    if (hasPin || centerLat === undefined || centerLng === undefined) return;
    mapRef.current?.animateToRegion(
      { latitude: centerLat, longitude: centerLng, latitudeDelta: AREA_DELTA, longitudeDelta: AREA_DELTA },
      400,
    );
  }, [centerLat, centerLng, hasPin]);

  // A pin on the map answers a "Use my location" that didn't work.
  useEffect(() => {
    if (hasPin) setLocate((current) => (current === 'denied' || current === 'failed' ? 'idle' : current));
  }, [hasPin, pin?.lat, pin?.lng]);

  // Debounced place search; only the newest answer is shown.
  useEffect(() => {
    const text = query.trim();
    if (text.length < PLACE_SEARCH_MIN_LENGTH) {
      setResults([]);
      setSearchState('idle');
      return;
    }
    let current = true;
    setSearchState('searching');
    const timer = setTimeout(() => {
      searchPlaces(text)
        .then((found) => {
          if (!current) return;
          setResults(found);
          setSearchState('done');
        })
        .catch(() => {
          if (!current) return;
          setResults([]);
          setSearchState('failed');
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const moveTo = (next: Pin) => {
    const rounded = roundPin(next);
    onPinChange(rounded);
    mapRef.current?.animateToRegion(
      { latitude: rounded.lat, longitude: rounded.lng, latitudeDelta: PIN_DELTA, longitudeDelta: PIN_DELTA },
      400,
    );
  };

  const pickPlace = (place: PlaceResult) => {
    setQuery('');
    setResults([]);
    setSearchState('idle');
    moveTo({ lat: place.lat, lng: place.lng });
  };

  const locateMe = async () => {
    setLocate('locating');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocate('denied');
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
      ]);
      if (!position) {
        setLocate('failed');
        return;
      }
      moveTo({ lat: position.coords.latitude, lng: position.coords.longitude });
      setLocate('idle');
    } catch {
      setLocate('failed');
    }
  };

  const locateError =
    locate === 'denied'
      ? t('customers.location.locationDenied')
      : locate === 'failed'
        ? t('customers.location.locationFailed')
        : null;

  return (
    <View style={styles.wrap}>
      <Field
        leadingIcon="search"
        value={query}
        onChangeText={setQuery}
        placeholder={t('customers.location.searchPlaceholder')}
        autoCapitalize="words"
        returnKeyType="search"
        helper={searchState === 'searching' ? t('customers.location.searching') : undefined}
      />
      {searchState === 'done' && results.length === 0 ? (
        <Text tone="secondary">{t('customers.location.noResults')}</Text>
      ) : null}
      {searchState === 'failed' ? <Text tone="danger">{t('customers.location.searchFailed')}</Text> : null}
      {results.length > 0 ? (
        <View style={styles.results}>
          {results.map((place, index) => (
            <Pressable
              key={place.key}
              onPress={() => pickPlace(place)}
              accessibilityRole="button"
              accessibilityLabel={place.name}
              android_ripple={{ color: colors.ripple }}
              style={[styles.result, index > 0 ? styles.resultDivider : null]}
            >
              <Icon name="map" size={20} tone="secondary" />
              <Text numberOfLines={2} style={styles.flex}>
                {place.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.map}>
        <View style={StyleSheet.absoluteFill} accessible accessibilityLabel={t('customers.location.mapA11y')}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            toolbarEnabled={false}
            onPress={(event: MapPressEvent) => {
              const { latitude, longitude } = event.nativeEvent.coordinate;
              onPinChange(roundPin({ lat: latitude, lng: longitude }));
            }}
          >
            {pin ? (
              <Marker
                coordinate={{ latitude: pin.lat, longitude: pin.lng }}
                title={t('customers.location.pin')}
                pinColor={colors.brand}
                draggable
                onDragEnd={(event: MarkerDragStartEndEvent) => {
                  const { latitude, longitude } = event.nativeEvent.coordinate;
                  onPinChange(roundPin({ lat: latitude, lng: longitude }));
                }}
              />
            ) : null}
          </MapView>
        </View>
        <View style={styles.locate} pointerEvents="box-none">
          <Button
            label={t('customers.location.useMyLocation')}
            onPress={() => void locateMe()}
            icon="navigate"
            variant="secondary"
            fullWidth={false}
            loading={locate === 'locating'}
            loadingLabel={t('customers.location.locating')}
            style={styles.locateButton}
          />
        </View>
      </View>

      <CostLine state={costState} locateError={locateError} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  results: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  result: {
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.sm,
  },
  resultDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  flex: { flex: 1 },
  map: {
    height: MAP_HEIGHT,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.sunken,
  },
  // "Use my location" over the map's bottom-end corner, 8 dp in.
  locate: { position: 'absolute', bottom: space.sm, end: space.sm, start: space.sm },
  // A hugging Button aligns itself to the start; this one belongs at the end.
  locateButton: { alignSelf: 'flex-end' },
});
