import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Icon, Screen, Text, colors, space } from '../../ui';

const FULL_SCREEN = ['top', 'left', 'right', 'bottom'] as const;

/**
 * The update gate (UX_MOBILE §3.6 gate 1; shop spec §C, driver spec D3): shown on
 * `APP_UPDATE_REQUIRED` or when `appConfig.minVersion` is above this build. "Update the app" and one
 * line. The footer's main button is "Get new version" when the office has set `links.updateUrl`, with
 * "Call office" above it; with no link, "Call office" is the main button. The office number also
 * comes from the copy kept on the phone, so it shows without signal.
 */
export function UpdateRequiredScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const updateUrl = config.links.updateUrl;

  const footer =
    office.phone || updateUrl ? (
      <>
        {office.phone ? (
          <Button
            label={t('common.actions.callOffice')}
            onPress={office.call}
            icon="call"
            variant={updateUrl ? 'secondary' : 'primary'}
            size="lg"
          />
        ) : null}
        {updateUrl ? (
          <Button
            label={t('common.update.download')}
            onPress={() => void Linking.openURL(updateUrl).catch(() => undefined)}
            icon="download"
            size="lg"
          />
        ) : null}
      </>
    ) : undefined;

  return (
    <Screen edges={FULL_SCREEN} footer={footer}>
      <View style={styles.body}>
        <View style={styles.badge}>
          <Icon name="download" size={32} tone="brand" />
        </View>
        <Text variant="title" align="center">
          {t('common.update.title')}
        </Text>
        <Text tone="secondary" align="center">
          {t('common.update.body')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.sm },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
