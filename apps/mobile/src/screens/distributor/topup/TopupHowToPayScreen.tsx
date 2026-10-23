import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clipboard, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { PaymentDto, TopupAccount, TopupInfoDto } from '@smartfleet/shared-types';
import { formatRs, toRupeesInput } from '@smartfleet/shared-utils';
import type { ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import type { PayChannel } from '../../../navigation/DistributorStack';
import {
  Button,
  Card,
  HeaderIconButton,
  Icon,
  ltr,
  QueryBoundary,
  Screen,
  SegmentedControl,
  SkeletonCard,
  space,
  StepHeader,
  Text,
  useToast,
} from '../../../ui';
import { fetchMyTopups, fetchTopupInfo } from '../shared/api';
import { useShopNavigation, useShopRoute } from '../shared/navigation';

/** "PK00TEST0000000000000000" → "PK00 TEST 0000 0000 0000 0000". */
function groupIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/**
 * S4 Add money, step 2 of 3 (shop spec §G): "Pay Rs 5,000" with a copy button for the amount, the
 * channel (Easypaisa or Bank app, as last time), the company account with "Check this name before
 * sending." and Copy IBAN, the path to follow in that app, and the WhatsApp warning. The account is
 * always fresh from `GET /payments/topup-info`, never from storage; on a test server it is whatever
 * the CLI set there, under the training strip.
 */
export function TopupHowToPayScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const toast = useToast();
  const { params } = useShopRoute<'TopupHowToPay'>();
  const info = useQuery<TopupInfoDto, ApiError>({ queryKey: qk.topups.info, queryFn: fetchTopupInfo });
  // The channel of the shop's last top-up, unless "Tell us again" brought one.
  const mine = useQuery<PaymentDto[], ApiError>({
    queryKey: qk.topups.mine,
    queryFn: fetchMyTopups,
    enabled: !params.payerChannel,
  });
  const [picked, setPicked] = useState<PayChannel | null>(params.payerChannel ?? null);
  const channel: PayChannel = picked ?? (mine.data?.[0]?.payerChannel === 'BANK_APP' ? 'BANK_APP' : 'EASYPAISA_APP');
  const account = info.data?.account;

  const copy = (value: string) => {
    Clipboard.setString(value);
    toast.show({ message: t('topup.howToPay.copied'), tone: 'success' });
  };

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
      <View>
        <StepHeader step={2} total={3} title={t('topup.howToPay.title', { amount: formatRs(params.amountPaisa) })} />
        {/* Beside the title: copies "5000", the amount to type in the bank app. */}
        <View style={styles.copyAmount}>
          <HeaderIconButton
            icon="copy"
            label={t('topup.howToPay.copyAmount')}
            onPress={() => copy(toRupeesInput(params.amountPaisa).replace(/,/g, ''))}
          />
        </View>
      </View>
      <QueryBoundary query={info} skeleton={<SkeletonCard lines={4} />}>
        {(data) => (
          <View style={styles.stack}>
            <SegmentedControl<PayChannel>
              accessibilityLabel={t('topup.howToPay.payWith')}
              options={[
                { value: 'EASYPAISA_APP', label: t('topup.howToPay.easypaisa') },
                { value: 'BANK_APP', label: t('topup.howToPay.bankApp') },
              ]}
              value={channel}
              onChange={setPicked}
            />
            <AccountCard account={data.account} onCopyIban={() => copy(data.account.iban.replace(/\s+/g, ''))} />
            <PathLine channel={channel} bank={data.account.bankName} />
            <Text variant="caption" tone="secondary">
              {t('topup.howToPay.noWhatsApp')}
            </Text>
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

/** The company account, with no labels: the values explain themselves. */
function AccountCard({ account, onCopyIban }: { account: TopupAccount; onCopyIban: () => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <View style={styles.account}>
        <Text variant="bodyStrong">{account.accountTitle}</Text>
        <View style={styles.check}>
          <Icon name="warn" size={16} tone="warning" />
          <Text variant="label" tone="warning" style={styles.flex}>
            {t('topup.howToPay.checkName')}
          </Text>
        </View>
        <Text tone="secondary">{account.bankName}</Text>
        <Text variant="mono" selectable>
          {ltr(groupIban(account.iban))}
        </Text>
        <Button label={t('topup.howToPay.copyIban')} onPress={onCopyIban} icon="copy" variant="secondary" fullWidth={false} />
      </View>
    </Card>
  );
}

/** Where to go in the app: "Bank Transfer › Test Bank › Paste IBAN" (Easypaisa) or "Transfer › Paste IBAN". */
function PathLine({ channel, bank }: { channel: PayChannel; bank: string }) {
  const { t } = useTranslation();
  const pieces =
    channel === 'EASYPAISA_APP'
      ? [t('topup.howToPay.ep.transfer'), t('topup.howToPay.ep.bank', { bank }), t('topup.howToPay.pasteIban')]
      : [t('topup.howToPay.app.transfer'), t('topup.howToPay.pasteIban')];
  return (
    <View style={styles.path} accessible accessibilityLabel={pieces.join(', ')}>
      {pieces.map((piece, index) => (
        <View key={`${index}-${piece}`} style={styles.piece}>
          {index > 0 ? <Icon name="chevron" size={20} tone="secondary" /> : null}
          <Text variant="bodyStrong">{piece}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  // Lines the 48 dp button up with the step title at the end of its row.
  copyAmount: { position: 'absolute', end: 0, bottom: space.sm },
  account: { gap: space.xs, alignItems: 'flex-start' },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'stretch' },
  path: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: space.xs },
  piece: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginEnd: space.xs },
});
