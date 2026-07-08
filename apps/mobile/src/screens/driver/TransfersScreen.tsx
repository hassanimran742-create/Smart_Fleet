import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { colors, radius, shadow, space } from '../../theme';

/**
 * Driver's view of scheduled inventory roll plans. Tap a card to open
 * the detail/scan flow (pickup at source → dropoff at destination).
 */
export function DriverTransfersScreen() {
  const nav = useNavigation<any>();

  const transfers = useQuery({
    queryKey: ['driver-transfers'],
    queryFn: async () => (await api.get('/transfers/mine')).data,
    refetchInterval: 30000,
  });

  const list = transfers.data ?? [];

  return (
    <Screen scroll>
      <Heading size="h2" style={{ marginBottom: space.sm }}>My transfer tasks</Heading>
      <Caption style={{ marginBottom: space.md }}>
        Tap a task to open it. Then scan each cylinder when picking up at the source store and again
        when dropping off at the destination.
      </Caption>

      {list.length === 0 && (
        <Card>
          <Body muted>No transfer tasks. You'll see them here when one is scheduled to you.</Body>
        </Card>
      )}

      {list.map((t: any) => {
        const tone = t.status === 'IN_TRANSIT' ? 'warn' : 'primary' as 'warn' | 'primary';
        return (
          <Pressable
            key={t.id}
            onPress={() => nav.navigate('TransferDetail', { transferId: t.id })}
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
                  <Caption style={{ marginTop: 4, color: colors.textMuted }} numberOfLines={2}>
                    {t.notes}
                  </Caption>
                )}
              </View>
              <Pill label={t.status} tone={tone} />
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}
