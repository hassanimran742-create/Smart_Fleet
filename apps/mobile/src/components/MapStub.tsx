import { View, Text, StyleSheet } from 'react-native';

// Lightweight stand-in for react-native-maps while we add a non-Google map
// (OSM via WebView) in a planned APK rebuild. Renders a card showing the
// picked lat/lng so the UX still confirms the address was accepted.
//
// Same prop names as MapView/Marker so existing screens compile unchanged.
// Methods like animateToRegion are no-ops here.

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
}

interface MapViewProps {
  initialRegion?: Region;
  region?: Region;
  style?: any;
  onPress?: (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  children?: any;
}

export default function MapView(_props: MapViewProps) {
  return (
    <View style={[styles.card, _props.style]}>
      <Text style={styles.title}>Map preview unavailable</Text>
      <Text style={styles.body}>
        Use the search above to set a delivery address. The interactive map
        returns in the next app update.
      </Text>
    </View>
  );
}

// Imperative methods used by callers (e.g. mapRef.current?.animateToRegion(...))
// — declared via a static so TS sees them on instance refs created with useRef<MapView>.
(MapView as any).prototype.animateToRegion = function () {};

interface MarkerProps {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  description?: string;
}

export function Marker(props: MarkerProps) {
  return (
    <View style={styles.marker}>
      <Text style={styles.markerText}>
        📍 {props.title ?? 'Selected'} · {props.coordinate.latitude.toFixed(4)}, {props.coordinate.longitude.toFixed(4)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dfe3ea',
    backgroundColor: '#f6f8fb',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontWeight: '700', color: '#33415c', marginBottom: 6 },
  body: { color: '#5a6478', fontSize: 12, textAlign: 'center' },
  marker: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#0F6CF0',
    borderRadius: 8,
    alignSelf: 'center',
  },
  markerText: { color: 'white', fontSize: 12, fontWeight: '600' },
});
