import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { TopupInfoDto } from '@smartfleet/shared-types';
import { formatClock, formatRs, parseRupeesInput, roundUpPaisa, toRupeesInput } from '@smartfleet/shared-utils';
import type { ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { useAppConfig } from '../../../hooks/useAppConfig';
import {
  AmountChips,
  Button,
  ErrorBanner,
  Icon,
  MoneyText,
  OTHER_AMOUNT,
  RupeeField,
  Screen,
  Skeleton,
  space,
  StepHeader,
  Text,
} from '../../../ui';
import { fetchTopupInfo } from '../shared/api';
import { isPositivePaisa, paisaOrZero } from '../shared/format';
import { useFormGuard, useShopNavigation, useShopRoute } from '../shared/navigation';
import { StaleNotice } from '../shared/StaleNotice';

/** A shortfall is rounded up to the next Rs 100 before it is offered (UX_MOBILE S3 Prefill). */
const SHORTFALL_STEP_PAISA = 10_000;

/** What is picked: nothing yet, a quick amount, or "Other amount" (typed in its field). */
type Choice = { kind: 'none' } | { kind: 'chip'; paisa: number } | { kind: 'other' };

/**
 * S3 Add money, step 1 of 3 (shop spec §F): the quick amounts in a 2×2 grid with "Other amount", which
 * opens the typed field (the keyboard opens only then), and when money is checked. "Next" stays
 * enabled and says what is missing ("Pick an amount."). Opened from an order short of money, the
 * amount is the larger of the minimum and the shortfall rounded up to Rs 100; from "Tell us again",
 * the request's amount. A prefill that matches a chip picks that chip.
 */
export function TopupAmountScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const { params } = useShopRoute<'TopupAmount'>();
  const { config } = useAppConfig();
  const info = useQuery<TopupInfoDto, ApiError>({ queryKey: qk.topups.info, queryFn: fetchTopupInfo });

  // With no answer the chips and limits come from the app config, so the person can still pick.
  const quick = info.data?.quickAmountsPaisa.length ? info.data.quickAmountsPaisa : config.topup.quickAmountsPaisa;
  const limits = info.data?.limits ?? { minPaisa: config.topup.minPaisa, maxPaisa: config.topup.maxPaisa, maxNowPaisa: null };
  const hours = info.data?.checkingHours ?? config.topup.checkingHours;
  const quickAmounts = quick.map((amount) => paisaOrZero(amount)).filter((amount) => amount > 0);
  const quickKey = quickAmounts.join(',');

  const [choice, setChoice] = useState<Choice>({ kind: 'none' });
  const [otherText, setOtherText] = useState('');
  const [focusOther, setFocusOther] = useState(false);
  const [pressed, setPressed] = useState(false);
  const edited = useRef(false);
  const initialAmount = useRef<number | null>(null);

  // The prefill: the refused request's amount, or an order's shortfall (which needs the minimum).
  const minPaisa = paisaOrZero(limits.minPaisa);
  const prefill = params?.amountPaisa
    ? paisaOrZero(params.amountPaisa)
    : params?.shortByPaisa
      ? Math.max(minPaisa, roundUpPaisa(Math.max(0, paisaOrZero(params.shortByPaisa)), SHORTFALL_STEP_PAISA))
      : null;
  useEffect(() => {
    if (edited.current || prefill === null || prefill <= 0) return;
    initialAmount.current = prefill;
    if (quickKey.split(',').map(Number).includes(prefill)) {
      setChoice({ kind: 'chip', paisa: prefill });
    } else {
      setChoice({ kind: 'other' });
      setOtherText(toRupeesInput(String(prefill)));
    }
  }, [prefill, quickKey]);

  const amount = choice.kind === 'chip' ? choice.paisa : choice.kind === 'other' ? parseRupeesInput(otherText) : null;
  useFormGuard(choice.kind !== 'none' && amount !== initialAmount.current);

  const limitError = (() => {
    if (amount === null || amount <= 0) return choice.kind === 'other' ? t('topup.amount.tooLow', { min: formatRs(limits.minPaisa) }) : null;
    if (amount < paisaOrZero(limits.minPaisa)) return t('topup.amount.tooLow', { min: formatRs(limits.minPaisa) });
    if (amount > paisaOrZero(limits.maxPaisa)) return t('topup.amount.tooHigh', { max: formatRs(limits.maxPaisa) });
    if (limits.maxNowPaisa !== null && amount > paisaOrZero(limits.maxNowPaisa)) {
      return t('errors.TOPUP_WOULD_EXCEED_CAP', {
        replace: { cap: formatRs(config.wallet.capPaisa), maxNow: formatRs(limits.maxNowPaisa) },
      });
    }
    return null;
  })();

  const firstLoad = info.data === undefined && info.isPending;
  const notConfigured = info.data === undefined && info.error?.code === 'TOPUP_ACCOUNT_NOT_CONFIGURED';
  // A chip's problem shows under the chips; a typed amount's under its field.
  const chipsLine = pressed ? (choice.kind === 'none' ? t('topup.amount.pick') : choice.kind === 'chip' ? limitError : null) : null;
  const fieldError = pressed && choice.kind === 'other' ? limitError : null;
  const pending = info.data && info.data.pending.count > 0 && isPositivePaisa(info.data.pending.totalPaisa) ? info.data.pending : null;

  const next = () => {
    setPressed(true);
    if (firstLoad || notConfigured || amount === null || amount <= 0 || limitError) return;
    navigation.navigate('TopupHowToPay', {
      amountPaisa: String(amount),
      payerName: params?.payerName,
      payerChannel: params?.payerChannel,
    });
  };

  return (
    <Screen
      footer={<Button label={t('common.actions.next')} onPress={next} size="lg" disabled={firstLoad || notConfigured} />}
    >
      <StepHeader step={1} total={3} title={t('topup.amount.title')} />
      <View style={styles.stack}>
        {info.isError && info.data ? <StaleNotice updatedAt={info.dataUpdatedAt} onRetry={() => void info.refetch()} /> : null}
        {/* No answer at all is the banner's to say; a server refusal is said here, with its fix. */}
        {info.isError && !info.data && info.error && info.error.status !== null ? (
          <ErrorBanner error={info.error} onRetry={notConfigured ? undefined : () => void info.refetch()} />
        ) : null}

        {pending ? (
          <View style={styles.pending}>
            <Icon name="checking" size={20} tone="warning" />
            <Text style={styles.flex}>{t('wallet.card.beingChecked')}</Text>
            <MoneyText paisa={pending.totalPaisa} variant="bodyStrong" />
          </View>
        ) : null}

        {firstLoad ? (
          <View style={styles.skeletons}>
            <Skeleton height={48} rounded={24} />
            <Skeleton height={48} rounded={24} />
          </View>
        ) : (
          <View style={styles.group}>
            <AmountChips
              accessibilityLabel={t('topup.amount.title')}
              optionsPaisa={quickAmounts.map(String)}
              selectedPaisa={choice.kind === 'chip' ? String(choice.paisa) : choice.kind === 'other' ? OTHER_AMOUNT : null}
              columns={2}
              otherLabel={t('topup.amount.other')}
              onSelect={(value) => {
                edited.current = true;
                if (value === OTHER_AMOUNT) {
                  setChoice({ kind: 'other' });
                  setFocusOther(true);
                } else {
                  setChoice({ kind: 'chip', paisa: paisaOrZero(value) });
                }
              }}
            />
            {chipsLine ? (
              <View style={styles.line} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Icon name="error" size={16} tone="danger" />
                <Text variant="caption" tone="danger" style={styles.flex}>
                  {chipsLine}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {choice.kind === 'other' ? (
          <RupeeField
            label={t('topup.amount.other')}
            value={otherText}
            onChangeText={(value) => {
              edited.current = true;
              setOtherText(value);
            }}
            autoFocus={focusOther}
            maxLength={9}
            returnKeyType="done"
            onSubmitEditing={next}
            error={fieldError}
            helper={t('topup.amount.limits', { min: formatRs(limits.minPaisa), max: formatRs(limits.maxPaisa) })}
          />
        ) : null}

        <Text variant="caption" tone="secondary">
          {t('topup.amount.hours', { from: formatClock(hours.from), to: formatClock(hours.to) })}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  group: { gap: space.sm },
  flex: { flex: 1 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  skeletons: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
