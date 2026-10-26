import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { DistributorDto } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Card, colors, ListRow, ltr, QueryBoundary, Screen, SkeletonCard, space, Text } from '../../ui';
import { fetchDistributorMe } from './shared/api';
import { phoneText } from './shared/format';
import { shopKeys } from './shared/keys';
import { usePullRefresh } from './shared/refresh';

/**
 * S12 Profile, read-only (shop spec §V): icon rows with no visible labels (screen readers still hear
 * them): the business name (and the contact's name when it differs), the mobile, and the store with
 * its address. "Only the office can change these." and "Call office" at the bottom. No shop code,
 * CNIC, role or IDs, and nothing to edit.
 */
export function ProfileScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const me = useQuery<DistributorDto, ApiError>({ queryKey: shopKeys.distributorMe, queryFn: fetchDistributorMe });
  const pull = usePullRefresh(me.refetch);

  return (
    <Screen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        office.phone ? (
          <Button label={t('common.actions.callOffice')} onPress={office.call} size="lg" icon="call" />
        ) : undefined
      }
    >
      <QueryBoundary query={me} skeleton={<SkeletonCard lines={3} />}>
        {(shop) => {
          const contactDiffers = shop.contact.name.trim() !== '' && shop.contact.name.trim() !== shop.businessName.trim();
          const mobile = ltr(phoneText(shop.contact.phone));
          const storeName = shop.store?.name ?? t('home.profile.storeNotSet');
          const said = (label: string, value: string) => t('home.profile.rowA11y', { label, value });
          return (
            <View style={styles.stack}>
              <Card padding={0}>
                <ListRow
                  leadingIcon="store"
                  title={shop.businessName}
                  subtitle={contactDiffers ? shop.contact.name : undefined}
                  accessibilityLabel={[
                    said(t('home.profile.businessName'), shop.businessName),
                    contactDiffers ? said(t('home.profile.name'), shop.contact.name) : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                />
                <View style={styles.divider} />
                <ListRow leadingIcon="call" title={mobile} accessibilityLabel={said(t('home.profile.mobile'), mobile)} />
                <View style={styles.divider} />
                <ListRow
                  leadingIcon="map"
                  title={storeName}
                  subtitle={shop.store?.address ?? undefined}
                  accessibilityLabel={[
                    said(t('home.profile.store'), storeName),
                    shop.store?.address ? said(t('home.profile.storeAddress'), shop.store.address) : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                />
              </Card>
              <Text variant="caption" tone="secondary">
                {t('home.profile.changeNote')}
              </Text>
            </View>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  divider: { height: 1, backgroundColor: colors.border },
});
