import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { formatPkPhone } from '@smartfleet/shared-utils';
import { APP_VERSION, currentUpdateId } from '../../api/appInfo';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Card, Icon, Text, ltr, space } from '../../ui';
import { DriverScreen } from './components';

/**
 * Help (replaces the shop's About screen in the driver app, which showed a placeholder number): call
 * or WhatsApp the office from `support.*` settings, the office hours, and the app version for support.
 */
export function DriverHelpScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const updateId = currentUpdateId();
  const version = ltr(APP_VERSION);

  return (
    <DriverScreen
      footer={
        office.phone ? (
          <Button label={t('common.actions.callTheOffice')} icon="call" onPress={office.call} testID="help.call" />
        ) : undefined
      }
    >
      <View style={styles.stack}>
        <Card>
          <View style={styles.card}>
            <Icon name="help" size={32} tone="brand" />
            <Text variant="title">{t('driver.help.title')}</Text>
            <Text>{t('driver.help.body')}</Text>
            {office.phone ? (
              <Text variant="bodyStrong">{ltr(formatPkPhone(office.phone))}</Text>
            ) : (
              <Text tone="secondary">{t('driver.help.noPhone')}</Text>
            )}
            {office.hours ? <Text tone="secondary">{t('driver.help.hours', { hours: office.hours })}</Text> : null}
            {office.whatsApp ? (
              <Button
                label={t('driver.help.whatsApp')}
                icon="whatsApp"
                variant="secondary"
                onPress={office.openWhatsApp}
                testID="help.whatsApp"
              />
            ) : null}
          </View>
        </Card>
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
