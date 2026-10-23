import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { APP_VERSION, currentUpdateId } from '../../api/appInfo';
import { signOut } from '../../api/session';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Card, confirm, Screen, space, Text } from '../../ui';

/** The over-the-air update in short form: enough for the office to tell builds apart, never a whole id. */
const UPDATE_ID_LENGTH = 8;

/**
 * S12 Help (replaces AboutScreen for the shop app): "Call the office" and "WhatsApp the office" from
 * the app config (WhatsApp only when it is set), how top-ups work, when the delivery cost comes back
 * (following `orders.deliveryStartedAt`), the app version and Sign out.
 */
export function HelpScreen() {
  return <HelpContent shop />;
}

/**
 * The help page body. The shop app shows its money texts; the driver app's About (and the retired
 * customer app) show only the office's numbers, the version and Sign out.
 */
export function HelpContent({ shop }: { shop: boolean }) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const updateId = currentUpdateId();

  const askSignOut = () =>
    void confirm({
      title: t('common.signOut.title'),
      confirmLabel: t('common.signOut.confirm'),
      confirmTone: 'danger',
      cancelLabel: t('common.signOut.cancel'),
      onConfirm: () => signOut(),
    });

  return (
    <Screen>
      <View style={styles.stack}>
        <Card>
          <Text variant="heading">{t('home.help.contactTitle')}</Text>
          {office.phone ? (
            <View style={styles.actions}>
              <Button label={t('home.help.callOffice')} onPress={office.call} icon="call" />
              {office.whatsApp ? (
                <Button label={t('home.help.whatsApp')} onPress={office.openWhatsApp} icon="whatsApp" variant="secondary" />
              ) : null}
            </View>
          ) : (
            <Text tone="secondary" style={styles.line}>
              {t('home.help.noPhone')}
            </Text>
          )}
          {office.hours ? (
            <Text tone="secondary" style={styles.line}>
              {t('home.help.hours', { hours: office.hours })}
            </Text>
          ) : null}
        </Card>

        {shop ? (
          <>
            <Card>
              <Text variant="heading">{t('home.help.topupsTitle')}</Text>
              <Text style={styles.line}>{t('home.help.topupsBody')}</Text>
            </Card>
            <Card>
              <Text variant="heading">{t('home.help.refundTitle')}</Text>
              <Text style={styles.line}>{t(`home.help.refund.${config.orders.deliveryStartedAt}`)}</Text>
            </Card>
          </>
        ) : null}

        <Card>
          <Text variant="heading">{t('home.help.appTitle')}</Text>
          <Text tone="secondary" style={styles.line}>
            {updateId
              ? t('home.help.version', { version: APP_VERSION, id: updateId.slice(0, UPDATE_ID_LENGTH) })
              : t('home.help.versionNoUpdate', { version: APP_VERSION })}
          </Text>
          <Button
            label={t('home.help.signOut')}
            onPress={askSignOut}
            icon="signOut"
            variant="ghost"
            fullWidth={false}
            style={styles.line}
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  actions: { gap: space.sm, marginTop: space.md },
  line: { marginTop: space.sm },
});
