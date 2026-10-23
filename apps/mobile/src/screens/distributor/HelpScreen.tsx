import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { APP_VERSION, currentUpdateId } from '../../api/appInfo';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Card, Screen, space, Text } from '../../ui';

/** The over-the-air update in short form: enough for the office to tell builds apart, never a whole id. */
const UPDATE_ID_LENGTH = 8;

/**
 * S12 Help (shop spec §W): two one-line answers (when the delivery cost comes back, following
 * `orders.deliveryStartedAt`, and how top-ups work), the office hours, the app version for support,
 * and "WhatsApp office" and "Call office" at the bottom. The number comes from the app config, or the
 * one kept from the last good answer while the server is down. Sign out is in the menu only.
 */
export function HelpScreen() {
  return <HelpContent shop />;
}

/**
 * The help page body. The shop app shows its two answers; the retired customer app's About
 * (`shop={false}`) shows only the office's hours and the version. Both have the office's buttons.
 */
export function HelpContent({ shop }: { shop: boolean }) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const updateId = currentUpdateId();

  const footer = office.phone ? (
    <>
      {office.whatsApp ? (
        <Button
          label={t('common.actions.whatsAppOffice')}
          onPress={office.openWhatsApp}
          icon="whatsApp"
          variant="secondary"
          size="lg"
        />
      ) : null}
      <Button label={t('common.actions.callOffice')} onPress={office.call} icon="call" size="lg" />
    </>
  ) : (
    <Text tone="secondary" align="center">
      {t('home.help.noPhone')}
    </Text>
  );

  return (
    <Screen footer={footer}>
      <View style={styles.stack}>
        {shop ? (
          <>
            <Card>
              <Text variant="heading">{t('home.help.refundTitle')}</Text>
              <Text style={styles.line}>{t(`orders.new.refundRule.${config.orders.deliveryStartedAt}`)}</Text>
            </Card>
            <Card>
              <Text variant="heading">{t('home.help.topupsTitle')}</Text>
              <Text style={styles.line}>{t('home.help.topupsBody')}</Text>
            </Card>
          </>
        ) : null}
        {office.hours ? (
          <Text variant="caption" tone="secondary">
            {t('home.help.hours', { hours: office.hours })}
          </Text>
        ) : null}
        <Text variant="caption" tone="secondary">
          {updateId
            ? t('home.help.version', { version: APP_VERSION, id: updateId.slice(0, UPDATE_ID_LENGTH) })
            : t('home.help.versionNoUpdate', { version: APP_VERSION })}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  line: { marginTop: space.xs },
});
