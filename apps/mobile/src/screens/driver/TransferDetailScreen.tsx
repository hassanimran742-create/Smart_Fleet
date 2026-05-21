import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

interface TransferLine {
  id: string;
  cylinderId: string;
  cylinder?: {
    id: string;
    qrCode: string;
    serial: string;
    custodyType: 'STORE' | 'VEHICLE' | 'CLIENT' | 'DISTRIBUTOR';
    custodyId: string;
    state: string;
    cylinderType?: { name: string; weightKg: string };
  };
}

interface Transfer {
  id: string;
  status: 'REQUESTED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  fromStoreId: string;
  toStoreId: string;
  scheduledFor: string | null;
  notes: string | null;
  fromStore?: { name: string };
  toStore?: { name: string };
  lines: TransferLine[];
}

interface Progress {
  total: number;
  atFromStore: number;
  onVehicle: number;
  atDestinationStore: number;
  misrouted: number;
  phase: 'PICKUP' | 'DROPOFF' | 'DONE';
}

/**
 * Per-cylinder progress: shows pickup status at source, in-transit
 * on vehicle, and dropped-off at destination. Big buttons drive scan
 * mode for the right phase.
 */
export function TransferDetailScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const transferId = route.params?.transferId;

  const detail = useQuery<Transfer>({
    queryKey: ['transfer', transferId],
    queryFn: async () => (await api.get(`/transfers/${transferId}`)).data,
    refetchInterval: 15000,
  });
  const progress = useQuery<Progress>({
    queryKey: ['transfer-progress', transferId],
    queryFn: async () => (await api.get(`/transfers/${transferId}/progress`)).data,
    refetchInterval: 15000,
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/transfers/${transferId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfer', transferId] });
      qc.invalidateQueries({ queryKey: ['driver-transfers'] });
    },
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });

  const t = detail.data;
  const p = progress.data;

  if (!t) return <Screen><Body muted>Loading…</Body></Screen>;

  const phase = p?.phase ?? 'PICKUP';
  const canCancel = t.status !== 'COMPLETED' && t.status !== 'CANCELLED';

  function lineStatus(line: TransferLine): { label: string; tone: 'primary' | 'warn' | 'ok' | 'danger' } {
    const c = line.cylinder;
    if (!c) return { label: 'UNKNOWN', tone: 'danger' };
    if (c.custodyType === 'STORE' && c.custodyId === t!.fromStoreId) return { label: 'AT SOURCE', tone: 'primary' };
    if (c.custodyType === 'VEHICLE') return { label: 'ON YOUR VAN', tone: 'warn' };
    if (c.custodyType === 'STORE' && c.custodyId === t!.toStoreId) return { label: 'DELIVERED', tone: 'ok' };
    return { label: 'MISROUTED', tone: 'danger' };
  }

  return (
    <Screen scroll>
      <Card>
        <Caption>FROM</Caption>
        <Heading size="h2" style={{ marginBottom: space.sm }}>{t.fromStore?.name}</Heading>
        <Caption>TO</Caption>
        <Heading size="h2">{t.toStore?.name}</Heading>
        {t.scheduledFor && (
          <Caption style={{ marginTop: space.sm, color: colors.textMuted }}>
            Scheduled: {new Date(t.scheduledFor).toLocaleDateString()}
          </Caption>
        )}
        {t.notes && (
          <Caption style={{ marginTop: space.sm, color: colors.textMuted }}>{t.notes}</Caption>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: space.md }}>
          <Pill label={t.status} tone={t.status === 'IN_TRANSIT' ? 'warn' : t.status === 'COMPLETED' ? 'ok' : 'primary'} />
          <Pill label={`${p?.total ?? t.lines.length} cylinders`} tone="primary" />
        </View>
      </Card>

      {/* Progress summary */}
      <Card>
        <Heading size="h3" style={{ marginBottom: space.sm }}>Progress</Heading>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <ProgressTile label="At source" count={p?.atFromStore ?? 0} tone="primary" />
          <ProgressTile label="On your van" count={p?.onVehicle ?? 0} tone="warn" />
          <ProgressTile label="Delivered" count={p?.atDestinationStore ?? 0} tone="ok" />
        </View>
      </Card>

      {/* Action buttons */}
      {phase === 'PICKUP' && t.status !== 'COMPLETED' && (
        <Button
          title="📷 Scan to pick up from source store"
          onPress={() => nav.navigate('TransferScan', { transferId, phase: 'PICKUP' })}
        />
      )}
      {phase === 'DROPOFF' && t.status !== 'COMPLETED' && (
        <Button
          title="📷 Scan to drop off at destination store"
          onPress={() => nav.navigate('TransferScan', { transferId, phase: 'DROPOFF' })}
        />
      )}
      {phase === 'DONE' && t.status === 'COMPLETED' && (
        <Card>
          <Body style={{ color: colors.ok, fontWeight: '700' }}>✓ Transfer complete</Body>
        </Card>
      )}

      {/* Per-cylinder rows */}
      <Heading size="h3" style={{ marginTop: space.lg, marginBottom: space.sm }}>Cylinders</Heading>
      {t.lines.map((line) => {
        const s = lineStatus(line);
        const c = line.cylinder;
        return (
          <Card key={line.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }}>
                {c?.cylinderType?.name ?? 'Cylinder'}
                {c?.cylinderType?.weightKg ? ` · ${Number(c.cylinderType.weightKg)}kg` : ''}
              </Body>
              <Caption style={{ fontFamily: 'monospace', marginTop: 2 }} numberOfLines={1}>
                {c?.serial ?? line.cylinderId.slice(0, 8)}
              </Caption>
            </View>
            <Pill label={s.label} tone={s.tone} />
          </Card>
        );
      })}

      {canCancel && (
        <Button
          title="✕ Cancel this transfer"
          variant="ghost"
          onPress={() => {
            Alert.alert('Cancel transfer?', 'This cannot be undone.', [
              { text: 'Back', style: 'cancel' },
              { text: 'Cancel transfer', style: 'destructive', onPress: () => setStatus.mutate('CANCELLED') },
            ]);
          }}
        />
      )}
    </Screen>
  );
}

function ProgressTile({ label, count, tone }: { label: string; count: number; tone: 'primary' | 'warn' | 'ok' }) {
  const bg = tone === 'primary' ? colors.primary : tone === 'warn' ? '#f59e0b' : colors.ok;
  return (
    <View style={{ flex: 1, backgroundColor: bg, padding: space.md, borderRadius: 12, alignItems: 'center' }}>
      <Heading size="h1" style={{ color: 'white' }}>{count}</Heading>
      <Caption style={{ color: 'rgba(255,255,255,0.9)', marginTop: 2 }}>{label}</Caption>
    </View>
  );
}
