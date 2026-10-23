import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { formatPkPhone } from '@smartfleet/shared-utils';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { fetchMe, type MeDto } from '../../api/me';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Card, QueryBoundary, SkeletonCard, Text, ltr, space } from '../../ui';
import { DriverScreen, InfoRow, usePullToRefresh } from './components';

/**
 * The driver's profile, read-only (UX_MOBILE §5): name, mobile number, licence and van. No CNIC, role
 * or ids. Changes go through the office.
 */
export function DriverProfileScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const me = useQuery<MeDto, ApiError>({ queryKey: qk.me, queryFn: fetchMe });
  const pull = usePullToRefresh(me.refetch);

  return (
    <DriverScreen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        office.phone ? (
          <Button label={t('common.actions.callTheOffice')} icon="call" onPress={office.call} testID="profile.call" />
        ) : undefined
      }
    >
      <QueryBoundary query={me} skeleton={<SkeletonCard lines={4} />}>
        {(profile) => {
          const plate = profile.driverProfile?.currentVehicle?.plateNo;
          return (
            <View style={styles.stack}>
              <Card>
                <InfoRow label={t('driver.profile.name')} value={profile.name} />
                <InfoRow label={t('driver.profile.phone')} value={ltr(formatPkPhone(profile.phone))} />
                {profile.driverProfile?.licenceNo ? (
                  <InfoRow label={t('driver.profile.licence')} value={ltr(profile.driverProfile.licenceNo)} />
                ) : null}
                <InfoRow label={t('driver.profile.van')} value={plate ? ltr(plate) : t('common.menu.vanNone')} />
              </Card>
              <Text tone="secondary">{t('driver.profile.note')}</Text>
            </View>
          );
        }}
      </QueryBoundary>
    </DriverScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
