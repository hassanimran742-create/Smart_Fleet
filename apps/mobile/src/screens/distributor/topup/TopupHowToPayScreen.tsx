import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clipboard, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { TopupInfoDto } from '@smartfleet/shared-types';
import { formatRs, toRupeesInput } from '@smartfleet/shared-utils';
import type { ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import {
  Button,
  Card,
  ErrorBanner,
  ltr,
  MoneyText,
  Screen,
  SegmentedControl,
  SkeletonCard,
  space,
  StepHeader,
  Text,
  useToast,
} from '../../../ui';
import { fetchTopupInfo } from '../shared/api';
import { useShopNavigation, useShopRoute } from '../shared/navigation';
import { Notice } from '../shared/Notice';
import { StaleNotice } from '../shared/StaleNotice';

type PayChannel = 'EASYPAISA_APP' | 'BANK_APP';

/** "PK00TEST0000000000000000" → "PK00 TEST 0000 0000 0000 0000". */
function groupIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/**
 * S4 Add money, step 2 of 3: "How to pay" (agreed sample screen 3). The company account from
 * `topup-info.account` with Copy IBAN and Copy amount, the steps for Easypaisa or a bank app, the
 * account-name warning and the checking hours. On a test server the account is whatever the CLI set
 * there, under the EnvBanner; nothing else changes.
 */
export function TopupHowToPayScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const toast = useToast();
  const { params } = useShopRoute<'TopupHowToPay'>();
  const info = useQuery<TopupInfoDto, ApiError>({ queryKey: qk.topups.info, queryFn: fetchTopupInfo });
  const [channel, setChannel] = useState<PayChannel>(params.payerChannel === 'BANK_APP' ? 'BANK_APP' : 'EASYPAISA_APP');
  const amount = formatRs(params.amountPaisa);

  const copy = (value: string) => {
    Clipboard.setString(value);
    toast.show({ message: t('topup.howToPay.copied'), tone: 'success' });
  };

  const steps =
    channel === 'EASYPAISA_APP'
      ? [t('topup.howToPay.ep1'), t('topup.howToPay.ep2'), t('topup.howToPay.ep3', { amount }), t('topup.howToPay.ep4')]
      : [t('topup.howToPay.bank1'), t('topup.howToPay.bank2'), t('topup.howToPay.bank3', { amount }), t('topup.howToPay.bank4')];

  const account = info.data?.account;
  const hours = info.data?.checkingHours;

  return (
    <Screen
      footer={
        <Button
          label={t('topup.howToPay.paid')}
          onPress={() =>
            navigation.navigate('TopupTellUs', {
              amountPaisa: params.amountPaisa,
              payerChannel: channel,
              payerName: params.payerName,
            })
          }
          size="lg"
          disabled={!account}
        />
      }
    >
      <StepHeader step={2} total={3} title={t('topup.howToPay.title')} />
      {!info.data && info.isError ? (
        <ErrorBanner error={info.error} onRetry={() => void info.refetch()} />
      ) : !account || !hours ? (
        <SkeletonCard lines={4} />
      ) : (
        <View style={styles.stack}>
          {info.isError ? <StaleNotice updatedAt={info.dataUpdatedAt} onRetry={() => void info.refetch()} /> : null}
          <SegmentedControl<PayChannel>
            accessibilityLabel={t('topup.howToPay.payWith')}
            options={[
              { value: 'EASYPAISA_APP', label: t('topup.howToPay.easypaisa') },
              { value: 'BANK_APP', label: t('topup.howToPay.bankApp') },
            ]}
            value={channel}
            onChange={setChannel}
          />

          <Card>
            <View style={styles.field}>
              <Text variant="label" tone="secondary">
                {t('topup.howToPay.accountName')}
              </Text>
              <Text variant="bodyStrong">{account.accountTitle}</Text>
            </View>
            <View style={styles.field}>
              <Text variant="label" tone="secondary">
                {t('topup.howToPay.bank')}
              </Text>
              <Text>{account.bankName}</Text>
            </View>
            <View style={styles.field}>
              <Text variant="label" tone="secondary">
                {t('topup.howToPay.iban')}
              </Text>
              <Text variant="mono" selectable>
                {ltr(groupIban(account.iban))}
              </Text>
              <Button
                label={t('topup.howToPay.copyIban')}
                onPress={() => copy(account.iban.replace(/\s+/g, ''))}
                icon="copy"
                variant="secondary"
                fullWidth={false}
              />
            </View>
            <View style={styles.field}>
              <Text variant="label" tone="secondary">
                {t('topup.howToPay.amount')}
              </Text>
              <MoneyText paisa={params.amountPaisa} variant="title" />
              <Button
                label={t('topup.howToPay.copyAmount')}
                onPress={() => copy(toRupeesInput(params.amountPaisa).replace(/,/g, ''))}
                icon="copy"
                variant="secondary"
                fullWidth={false}
              />
            </View>
          </Card>

          <View style={styles.steps}>
            <Text variant="heading">{t('topup.howToPay.stepsTitle')}</Text>
            {steps.map((step, index) => (
              <View key={step} style={styles.stepRow}>
                <Text variant="bodyStrong" style={styles.stepNumber}>
                  {t('topup.howToPay.stepNumber', { number: index + 1 })}
                </Text>
                <Text style={styles.flex}>{step}</Text>
              </View>
            ))}
          </View>

          <Notice tone="warning" text={t('topup.howToPay.warning', { accountName: account.accountTitle })} />
          <Text tone="secondary">{t('topup.howToPay.hours', { from: hours.from, to: hours.to })}</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  field: { gap: space.xs, paddingVertical: space.sm, alignItems: 'flex-start' },
  steps: { gap: space.sm },
  stepRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  stepNumber: { minWidth: 24 },
  flex: { flex: 1 },
});
