import { useState } from 'react';
import { Alert, Button, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRoute } from '@react-navigation/native';
import { api } from '../../api/client';

type EventType =
  | 'SCAN_IN'
  | 'SCAN_OUT'
  | 'DELIVERED'
  | 'PICKED_UP_EMPTY'
  | 'RETURNED_TO_DISTRIBUTOR'
  | 'TRANSFER';

const FLOWS: { key: EventType; label: string; desc: string }[] = [
  { key: 'SCAN_IN', label: 'Receive (SCAN_IN)', desc: 'Cylinders arriving at this store from a distributor or vehicle.' },
  { key: 'SCAN_OUT', label: 'Load on vehicle', desc: 'Loading cylinders from store onto a vehicle for delivery.' },
  { key: 'DELIVERED', label: 'Deliver to client', desc: 'Cylinder handed to end customer.' },
  { key: 'PICKED_UP_EMPTY', label: 'Pick up empty', desc: 'Empty cylinder collected from client.' },
  { key: 'RETURNED_TO_DISTRIBUTOR', label: 'Return to distributor', desc: 'Empty cylinder going back to distributor for refill.' },
];

export function ScanScreen() {
  const route = useRoute<any>();
  const initialEvent: EventType = route.params?.eventType ?? 'SCAN_OUT';
  const tripId = route.params?.tripId;
  const orderId = route.params?.orderId;

  const [permission, requestPermission] = useCameraPermissions();
  const [eventType, setEventType] = useState<EventType>(initialEvent);
  const [scanned, setScanned] = useState(false);
  const [count, setCount] = useState(0);

  if (!permission) return <Text>Loading…</Text>;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ marginBottom: 12 }}>Camera permission is required</Text>
        <Button title="Grant" onPress={requestPermission} />
      </View>
    );
  }

  async function onScanned(data: string) {
    if (scanned) return;
    setScanned(true);
    try {
      const { data: result } = await api.post('/custody/scan', {
        qrCode: data,
        eventType,
        tripId,
        orderId,
      });
      setCount((c) => c + 1);
      Alert.alert('Scan recorded', `Cylinder now: ${result.newState} → ${result.toType}`);
    } catch (e: any) {
      Alert.alert('Scan failed', e?.response?.data?.message ?? 'Try again');
    } finally {
      setTimeout(() => setScanned(false), 1500);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 8, backgroundColor: '#fafafa' }}>
        <Text style={{ fontWeight: '600' }}>Event type</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {FLOWS.map((f) => (
            <Button
              key={f.key}
              title={f.label}
              onPress={() => setEventType(f.key)}
              color={eventType === f.key ? '#0f6cf0' : '#888'}
            />
          ))}
        </View>
        <Text style={{ color: '#666', fontSize: 12 }}>
          {FLOWS.find((f) => f.key === eventType)?.desc}
        </Text>
        <Text style={{ color: '#1ea675' }}>Scanned this session: {count}</Text>
      </View>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
        onBarcodeScanned={scanned ? undefined : (r) => onScanned(r.data)}
      />
    </View>
  );
}
