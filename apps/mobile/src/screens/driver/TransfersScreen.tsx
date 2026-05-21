import { Alert, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

/**
 * Driver's view of scheduled inventory roll plans. Each transfer
 * shows: from store → to store, date, cylinder count, current status.
 * Tap to mark IN_TRANSIT, then COMPLETED when delivered.
 */
export function DriverTransfersScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();

  const transfers = useQuery({
    queryKey: ['driver-transfers'],
    queryFn: async () => (await api.get('/transfers/mine')).data,
    refetchInterval: 30000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/transfers/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-transfers'] }),
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });

  const list = transfers.data ?? [];

  return (
    <Screen scroll>
      <Heading size="h2" style={{ marginBottom: space.sm }}>My transfer tasks</Heading>
      <Caption style={{ marginBottom: space.md }}>
        Inventory roll plans assigned to you. Tap a task to update its status as you go.
      </Caption>

      {list.length === 0 && (
        <Card>
          <Body muted>No transfer tasks. You'll see them here when one is scheduled to you.</Body>
        </Card>
      )}

      {list.map((t: any) => (
        <Pressable
          key={t.id}
          onPress={() => {
            const next = t.status === 'REQUESTED' ? 'IN_TRANSIT' : 'COMPLETED';
            const label = next === 'IN_TRANSIT' ? 'Start this transfer?' : 'Mark this transfer complete?';
            Alert.alert(label, '', [
              { text: 'Cancel', style: 'cancel' },
              { text: next, onPress: () => setStatus.mutate({ id: t.id, status: next }) },
            ]);
          }}
          style={({ pressed }: any) => ({
            backgroundColor: colors.surface,
            padding: space.lg, borderRadius: radius.lg,
            marginBottom: space.sm, opacity: pressed ? 0.85 : 1,
            ...shadow.card,
          })}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Heading size="h3">
                {t.lines?.length ?? 0} cylinder{(t.lines?.length ?? 0) === 1 ? '' : 's'}
              </Heading>
              <Caption style={{ marginTop: 4 }}>
                From: <Body style={{ fontWeight: '600' }}>{t.fromStore?.name}</Body>
              </Caption>
              <Caption style={{ marginTop: 2 }}>
                To: <Body style={{ fontWeight: '600' }}>{t.toStore?.name}</Body>
              </Caption>
              {t.scheduledFor && (
                <Caption style={{ marginTop: 2, color: colors.textMuted }}>
                  Scheduled: {new Date(t.scheduledFor).toLocaleDateString()}
                </Caption>
              )}
              {t.notes && (
                <Caption style={{ marginTop: 4, color: colors.textMuted }}>
                  {t.notes}
                </Caption>
              )}
            </View>
            <Pill
              label={t.status}
              tone={t.status === 'IN_TRANSIT' ? 'warn' : 'primary'}
            />
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}
