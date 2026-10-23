import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { TopupInfoDto } from '@smartfleet/shared-types';
import { formatRs, parseRupeesInput, roundUpPaisa, toRupeesInput } from '@smartfleet/shared-utils';
import type { ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { useAppConfig } from '../../../hooks/useAppConfig';
import { AmountChips, Button, ErrorBanner, RupeeField, Screen, SkeletonCard, space, StepHeader } from '../../../ui';
import { fetchTopupInfo } from '../shared/api';
import { isPositivePaisa, paisaOrZero } from '../shared/format';
import { useFormGuard, useShopNavigation, useShopRoute } from '../shared/navigation';
import { Notice } from '../shared/Notice';
import { StaleNotice } from '../shared/StaleNotice';

/** A shortfall is rounded up to the next Rs 100 before it is offered (UX_MOBILE S3 Prefill). */
const SHORTFALL_STEP_PAISA = 10_000;

/**
 * S3 Add money, step 1 of 3: "How much do you want to add?" (agreed sample screen 2). The limits and
 * quick amounts come from `GET /payments/topup-info`. Opened from an order refused for money, the
 * amount is the larger of the minimum and the shortfall rounded up to Rs 100.
 */
export function TopupAmountScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const { params } = useShopRoute<'TopupAmount'>();
  const { config } = useAppConfig();
  const info = useQuery<TopupInfoDto, ApiError>({ queryKey: qk.topups.info, queryFn: fetchTopupInfo });

  const [text, setText] = useState(() => (params?.amountPaisa ? toRupeesInput(params.amountPaisa) : ''));
  const initialText = useRef(text);
  const edited = useRef(false);

  // The shortfall prefill needs the minimum: from the top-up info, else the app config until it loads.
  const minPaisa = paisaOrZero(info.data?.limits.minPaisa ?? config.topup.minPaisa);
  useEffect(() => {
    if (!params?.shortByPaisa || edited.current) return;
    const shortfall = roundUpPaisa(Math.max(0, paisaOrZero(params.shortByPaisa)), SHORTFALL_STEP_PAISA);
    const next = toRupeesInput(String(Math.max(minPaisa, shortfall)));
    initialText.current = next;
    setText(next);
  }, [params?.shortByPaisa, minPaisa]);

  useFormGuard(text !== '' && text !== initialText.current);

  const amount = parseRupeesInput(text);
  const limits = info.data?.limits;
  const error = (() => {
    if (!limits || amount === null || text === '') return null;
    if (amount < paisaOrZero(limits.minPaisa)) return t('topup.amount.tooLow', { min: formatRs(limits.minPaisa) });
    if (amount > paisaOrZero(limits.maxPaisa)) return t('topup.amount.tooHigh', { max: formatRs(limits.maxPaisa) });
    if (limits.maxNowPaisa !== null && amount > paisaOrZero(limits.maxNowPaisa)) {
      return t('errors.TOPUP_WOULD_EXCEED_CAP', {
        replace: { cap: formatRs(config.wallet.capPaisa), maxNow: formatRs(limits.maxNowPaisa) },
      });
    }
    return null;
  })();
  const canContinue = !!info.data && amount !== null && amount > 0 && error === null;

  const next = () => {
    if (!canContinue || amount === null) return;
    navigation.navigate('TopupHowToPay', {
      amountPaisa: String(amount),
      payerName: params?.payerName,
      payerChannel: params?.payerChannel,
    });
  };

  return (
    <Screen footer={<Button label={t('common.actions.next')} onPress={next} size="lg" disabled={!canContinue} />}>
      <StepHeader step={1} total={3} title={t('topup.amount.title')} />
      {info.data === undefined && info.isError ? (
        <ErrorBanner error={info.error} onRetry={() => void info.refetch()} />
      ) : info.data === undefined ? (
        <SkeletonCard lines={3} />
      ) : (
        <View style={styles.stack}>
          {info.isError ? <StaleNotice updatedAt={info.dataUpdatedAt} onRetry={() => void info.refetch()} /> : null}
          {info.data.pending.count > 0 && isPositivePaisa(info.data.pending.totalPaisa) ? (
            <Notice tone="brand" icon="checking" text={t('topup.amount.pending', { amount: formatRs(info.data.pending.totalPaisa) })} />
          ) : null}
          <RupeeField
            label={t('topup.amount.label')}
            value={text}
            onChangeText={(value) => {
              edited.current = true;
              setText(value);
            }}
            autoFocus={!text}
            maxLength={9}
            returnKeyType="done"
            onSubmitEditing={next}
            error={error}
            helper={t('topup.amount.limits', {
              min: formatRs(info.data.limits.minPaisa),
              max: formatRs(info.data.limits.maxPaisa),
            })}
          />
          <AmountChips
            optionsPaisa={info.data.quickAmountsPaisa.length ? info.data.quickAmountsPaisa : config.topup.quickAmountsPaisa}
            selectedPaisa={amount}
            onSelect={(paisa) => {
              edited.current = true;
              setText(toRupeesInput(paisa));
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
});
