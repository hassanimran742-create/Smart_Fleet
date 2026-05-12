import { useState } from 'react';
import { Alert, Button, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../../api/client';

export function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<string | null>(null);

  if (!permission) return <Text>Loading…</Text>;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ marginBottom: 12 }}>Camera permission is required</Text>
        <Button title="Grant" onPress={requestPermission} />
      </View>
    );
  }

  async function onScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(data);
    try {
      const { data: result } = await api.post('/custody/scan', {
        qrCode: data,
        eventType: 'SCAN_OUT',
      });
      Alert.alert('Scan recorded', JSON.stringify(result));
    } catch (e: any) {
      Alert.alert('Scan failed', e?.response?.data?.message ?? 'Try again');
    } finally {
      setTimeout(() => setScanned(null), 2000);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
        onBarcodeScanned={scanned ? undefined : (r) => onScanned({ data: r.data })}
      />
    </View>
  );
}
