import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { DistributorDto } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { Button, Card, ltr, QueryBoundary, Screen, SkeletonCard, space } from '../../ui';
import { fetchDistributorMe } from './shared/api';
import { phoneText } from './shared/format';
import { InfoRow } from './shared/InfoRow';
import { shopKeys } from './shared/keys';
import { Notice } from './shared/Notice';
import { usePullRefresh } from './shared/refresh';

/**
 * S12 Profile, read-only (UX_MOBILE §4): name, business name, shop code, mobile, store name and
 * address, with "To change these, call the office." No CNIC, role or IDs, and nothing to edit.
 */
export function ProfileScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const me = useQuery<DistributorDto, ApiError>({ queryKey: shopKeys.distributorMe, queryFn: fetchDistributorMe });
  const pull = usePullRefresh(me.refetch);

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <QueryBoundary query={me} skeleton={<SkeletonCard lines={5} />}>
        {(shop) => (
          <View style={styles.stack}>
            <Card>
              <InfoRow label={t('home.profile.name')} divider={false}>
                {shop.contact.name}
              </InfoRow>
              <InfoRow label={t('home.profile.businessName')}>{shop.businessName}</InfoRow>
              <InfoRow label={t('home.profile.shopCode')}>{ltr(shop.code)}</InfoRow>
              <InfoRow label={t('home.profile.mobile')}>{ltr(phoneText(shop.contact.phone))}</InfoRow>
              <InfoRow label={t('home.profile.store')}>{shop.store?.name ?? t('home.profile.storeNotSet')}</InfoRow>
              {shop.store?.address ? <InfoRow label={t('home.profile.storeAddress')}>{shop.store.address}</InfoRow> : null}
            </Card>
            <Notice tone="neutral" text={t('home.profile.changeNote')}>
              {office.phone ? (
                <Button
                  label={t('common.actions.callTheOffice')}
                  onPress={office.call}
                  icon="call"
                  variant="secondary"
                  fullWidth={false}
                />
              ) : null}
            </Notice>
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
});
