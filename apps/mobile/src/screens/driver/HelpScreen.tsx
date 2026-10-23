import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { formatPkPhone } from '@smartfleet/shared-utils';
import { APP_VERSION, currentUpdateId } from '../../api/appInfo';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { fetchMe, type MeDto } from '../../api/me';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Card, SkeletonLines, Text, ltr, space } from '../../ui';
import { DriverScreen, InfoRow, usePullToRefresh } from './components';

/**
 * Help, with the profile merged in (driver spec D16): the office's number, its hours and WhatsApp;
 * who you are (name, mobile, van) from `GET /users/me`; the app version for support; and "Call
 * office" as the one button. The office contact is the one saved on the phone, so it shows offline
 * too. The "You" card hides when it can't load: calling is this screen's job.
 */
export function DriverHelpScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const me = useQuery<MeDto, ApiError>({ queryKey: qk.me, queryFn: fetchMe });
  const pull = usePullToRefresh(me.refetch);
  const updateId = currentUpdateId();
  const version = ltr(APP_VERSION);
  const profile = me.data;
  const plate = profile?.driverProfile?.currentVehicle?.plateNo;

  return (
    <DriverScreen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        office.phone ? (
          <Button label={t('common.actions.callOffice')} icon="call" onPress={office.call} testID="help.call" />
        ) : undefined
      }
    >
      <View style={styles.stack}>
        <Card>
          <View style={styles.card}>
            {office.phone ? (
              <Text variant="title">{ltr(formatPkPhone(office.phone))}</Text>
            ) : (
              <Text tone="secondary">{t('driver.help.noPhone')}</Text>
            )}
            {office.hours ? <Text>{t('driver.help.hours', { hours: office.hours })}</Text> : null}
            {office.whatsApp ? (
              <Button
                label={t('common.actions.whatsAppOffice')}
                icon="whatsApp"
                variant="secondary"
                onPress={office.openWhatsApp}
                testID="help.whatsApp"
              />
            ) : null}
          </View>
        </Card>

        {profile ? (
          <Card testID="help.you">
            <InfoRow label={t('driver.help.name')} value={profile.name} />
            <InfoRow label={t('driver.help.phone')} value={ltr(formatPkPhone(profile.phone))} />
            <InfoRow label={t('driver.help.van')} value={plate ? ltr(plate) : t('common.menu.vanNone')} />
          </Card>
        ) : me.isPending ? (
          <Card>
            <SkeletonLines lines={3} />
          </Card>
        ) : null}

        <Text variant="caption" tone="secondary" align="center">
          {updateId
            ? t('driver.help.versionUpdate', { version, id: ltr(updateId.slice(0, 8)) })
            : t('driver.help.version', { version })}
        </Text>
      </View>
    </DriverScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  card: { gap: space.md },
});
