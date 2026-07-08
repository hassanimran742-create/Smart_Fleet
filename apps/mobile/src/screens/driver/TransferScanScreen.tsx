import { useRef, useState } from 'react';
import { Alert, Pressable, Vibration, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';

/**
 * Pickup / dropoff scanner for an inventory roll-plan transfer.
 * Route params: { transferId, phase: 'PICKUP' | 'DROPOFF' }.
 * Continuous-scan mode: each successful scan increments progress; the
 * camera re-arms after a short cooldown so the driver can keep scanning.
 */
export function TransferScanScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const transferId: string = route.params?.transferId;
  const phase: 'PICKUP' | 'DROPOFF' = route.params?.phase ?? 'PICKUP';

  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(0);
  const lastQrRef = useRef<string | null>(null);
  const lastQrTimeRef = useRef<number>(0);

  const detail = useQuery({
    queryKey: ['transfer', transferId],
    queryFn: async () => (await api.get(`/transfers/${transferId}`)).data,
  });
  const progress = useQuery({
    queryKey: ['transfer-progress', transferId],
    queryFn: async () => (await api.get(`/transfers/${transferId}/progress`)).data,
  });

  const phaseLabel = phase === 'PICKUP' ? 'PICK UP FROM SOURCE' : 'DROP OFF AT DESTINATION';
  const expectedHere = phase === 'PICKUP'
    ? progress.data?.atFromStore ?? 0
    : progress.data?.onVehicle ?? 0;

  if (!permission) {
    return <Screen><Body muted>Loading camera…</Body></Screen>;
  }
  if (!permission.granted) {
    return (
      <Screen>
        <Card>
          <Heading size="h3">Camera permission needed</Heading>
          <Body muted style={{ marginTop: space.sm }}>
            The app uses the camera only to scan cylinder QR codes for this transfer.
          </Body>
          <Button title="Grant access" onPress={requestPermission} />
        </Card>
      </Screen>
    );
  }

  async function handleScan(data: string) {
    if (busy) return;
    // Debounce repeated reads of the same QR within 2.5s
    if (lastQrRef.current === data && Date.now() - lastQrTimeRef.current < 2500) return;
    lastQrRef.current = data;
    lastQrTimeRef.current = Date.now();

    setBusy(true);
    try {
      // Best-effort location stamp; don't block scanning if it fails.
      let lat: number | undefined, lng: number | undefined;
      try {
        const pos = await Location.getLastKnownPositionAsync({});
        if (pos) { lat = pos.coords.latitude; lng = pos.coords.longitude; }
      } catch {}

      const res = await api.post(`/transfers/${transferId}/scan`, {
        qrCode: data,
        phase,
        lat,
        lng,
      });
      setDone((c) => c + 1);
      setLastResult({ ok: true, text: `✓ Scanned · ${res.data.progress.onVehicle} on van · ${res.data.progress.atDestinationStore} delivered` });
      Vibration.vibrate(50);
      // Refresh detail+progress + the home-screen list
      qc.invalidateQueries({ queryKey: ['transfer', transferId] });
      qc.invalidateQueries({ queryKey: ['transfer-progress', transferId] });
      qc.invalidateQueries({ queryKey: ['driver-transfers'] });

      // Auto-finish when the whole transfer is done
      if (res.data.transferStatus === 'COMPLETED') {
        Alert.alert(
          'Transfer complete',
          'All cylinders delivered to the destination store. Nice work!',
          [{ text: 'Done', onPress: () => nav.goBack() }],
        );
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Scan failed';
      setLastResult({ ok: false, text: '✕ ' + msg });
      Vibration.vibrate([0, 100, 80, 100]);
    } finally {
      // Re-arm after a brief cooldown so the next cylinder can be scanned
      setTimeout(() => setBusy(false), 800);
    }
  }

  return (
    <Screen>
      <Card style={{
        backgroundColor: phase === 'PICKUP' ? colors.primary : '#f59e0b',
        flexDirection: 'row', alignItems: 'center', gap: 12,
      }}>
        <View style={{ flex: 1 }}>
          <Caption style={{ color: 'rgba(255,255,255,0.8)' }}>PHASE</Caption>
          <Heading size="h2" style={{ color: 'white' }}>{phaseLabel}</Heading>
          <Caption style={{ color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
            {detail.data?.fromStore?.name} → {detail.data?.toStore?.name}
          </Caption>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Heading size="h1" style={{ color: 'white' }}>{done}</Heading>
          <Caption style={{ color: 'rgba(255,255,255,0.9)' }}>this session</Caption>
        </View>
      </Card>

      <Card style={{ marginBottom: space.sm }}>
        <Body>
          {phase === 'PICKUP'
            ? `Remaining at source: ${expectedHere} of ${progress.data?.total ?? '—'}`
            : `On van to drop off: ${expectedHere} of ${progress.data?.total ?? '—'}`}
        </Body>
      </Card>

      {lastResult && (
        <Card style={{ backgroundColor: lastResult.ok ? '#ecfdf5' : '#fef2f2' }}>
          <Body style={{ color: lastResult.ok ? colors.ok : colors.danger, fontWeight: '600' }}>
            {lastResult.text}
          </Body>
        </Card>
      )}

      <View style={{ flex: 1, overflow: 'hidden', borderRadius: radius.lg, marginTop: space.sm }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
          onBarcodeScanned={busy ? undefined : (r) => handleScan(r.data)}
        />
      </View>

      <Pressable
        onPress={() => nav.goBack()}
        style={({ pressed }: any) => ({
          marginTop: space.md, padding: space.md, alignItems: 'center',
          borderRadius: radius.md, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1,
        })}
      >
        <Body style={{ fontWeight: '600' }}>Done scanning</Body>
      </Pressable>
    </Screen>
  );
}
