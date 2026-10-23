import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayerChannel, PaymentDto, TopupInfoDto } from '@smartfleet/shared-types';
import { formatRs, parseRupeesInput, toRupeesInput } from '@smartfleet/shared-utils';
import { topupRequestSchema } from '@smartfleet/shared-validation';
import { useIdempotencyKey } from '../../../api/client';
import { fieldErrorsOf, toUserMessage, type ApiError } from '../../../api/errors';
import { invalidate, qk } from '../../../api/keys';
import { pickAndUploadFile } from '../../../api/upload';
import {
  Button,
  colors,
  ErrorBanner,
  Field,
  Icon,
  radius,
  RupeeField,
  Screen,
  SegmentedControl,
  sizes,
  space,
  StepHeader,
  Text,
  useToast,
} from '../../../ui';
import { fetchTopupInfo, sendTopupRequest, type TopupRequestBody } from '../shared/api';
import { capitaliseWords, paisaOrZero } from '../shared/format';
import { showSentTopup, useFormGuard, useShopNavigation, useShopRoute } from '../shared/navigation';

const PAYER_NAME_MAX = 60;
const TRANSACTION_ID_MAX = 40;
const ALL_CHANNELS: readonly PayerChannel[] = ['EASYPAISA_APP', 'BANK_APP', 'OTHER'];

type Proof =
  | { kind: 'none' }
  | { kind: 'uploading' }
  | { kind: 'uploaded'; fileId: string; uri: string }
  | { kind: 'failed' }
  | { kind: 'denied' };

/** Amount refusals are shown on the amount field; everything else in the banner. */
const AMOUNT_CODES: ReadonlySet<string> = new Set([
  'TOPUP_AMOUNT_TOO_SMALL',
  'TOPUP_AMOUNT_TOO_LARGE',
  'TOPUP_WOULD_EXCEED_CAP',
  'AMOUNT_NOT_WHOLE_RUPEES',
]);

/** The body fields this form shows a server field error on. */
const FIELD_PATHS: ReadonlySet<string> = new Set(['amountPaisa', 'payerName', 'transactionId']);

/**
 * S5 Add money, step 3 of 3: "Tell us you paid" (agreed sample screen 4). Sends
 * `POST /payments/topup-requests` with this intent's Idempotency-Key, so "Send for checking" tapped
 * again after a lost signal makes exactly one request. A screenshot is optional and a failed upload
 * never blocks sending. On success the status screen replaces the flow and says "Sent for checking".
 */
export function TopupTellUsScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { params } = useShopRoute<'TopupTellUs'>();
  const info = useQuery<TopupInfoDto, ApiError>({ queryKey: qk.topups.info, queryFn: fetchTopupInfo });

  const [amountText, setAmountText] = useState(() => toRupeesInput(params.amountPaisa));
  const [payerName, setPayerName] = useState(params.payerName ?? '');
  const [nameTouched, setNameTouched] = useState(false);
  const [channel, setChannel] = useState<PayerChannel>(params.payerChannel);
  const [transactionId, setTransactionId] = useState('');
  const [proof, setProof] = useState<Proof>({ kind: 'none' });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const amountPaisa = parseRupeesInput(amountText);
  const name = payerName.trim();
  const txn = transactionId.trim();

  // One key per intent: the same amount, name and channel keep it across retries (API_CONTRACT §4.2).
  const idem = useIdempotencyKey([amountPaisa, name, channel]);
  const guard = useFormGuard(
    name !== (params.payerName ?? '').trim() || txn !== '' || proof.kind === 'uploaded' || amountPaisa !== paisaOrZero(params.amountPaisa),
  );

  const send = useMutation<PaymentDto, ApiError, TopupRequestBody>({
    mutationFn: (body) => sendTopupRequest(body, idem.key),
    onSuccess: (payment) => {
      queryClient.setQueryData(qk.topups.byId(payment.id), payment);
      void invalidate.topupSent(queryClient);
      toast.show({ message: t('topup.tellUs.sent'), tone: 'success' });
      guard.release();
      showSentTopup(navigation, payment.id);
    },
    onError: (error) => {
      // The server can no longer find the screenshot: ask for it again rather than block sending.
      if (error.code === 'FILE_NOT_FOUND') setProof({ kind: 'none' });
    },
  });

  // ---- Validation (the shared schema is the one source of the rules) ----
  const limits = info.data?.limits;
  const nameOk = topupRequestSchema.shape.payerName.safeParse(name).success;
  const txnOk = txn === '' || topupRequestSchema.shape.transactionId.safeParse(txn).success;
  const amountError = (() => {
    if (amountPaisa === null || !limits) return null;
    if (amountPaisa < paisaOrZero(limits.minPaisa)) return t('topup.amount.tooLow', { min: formatRs(limits.minPaisa) });
    if (amountPaisa > paisaOrZero(limits.maxPaisa)) return t('topup.amount.tooHigh', { max: formatRs(limits.maxPaisa) });
    return null;
  })();
  const amountOk = amountPaisa !== null && amountPaisa > 0 && amountError === null;

  const serverError = send.error;
  const serverFields = serverError ? fieldErrorsOf(serverError, t) : {};
  const serverAmountError =
    serverError && AMOUNT_CODES.has(serverError.code) ? toUserMessage(serverError, t) : serverFields.amountPaisa ?? null;
  // Field problems this form can't point at (e.g. the channel) still get the banner.
  const unplacedField = Object.keys(serverFields).some((path) => !FIELD_PATHS.has(path));
  const bannerError =
    serverError && !AMOUNT_CODES.has(serverError.code) && (serverError.code !== 'VALIDATION_FAILED' || unplacedField)
      ? serverError
      : null;
  const offline = bannerError?.code === 'NETWORK_OFFLINE' || bannerError?.code === 'NETWORK_TIMEOUT';

  const canSend = amountOk && nameOk && txnOk && proof.kind !== 'uploading' && !send.isPending;
  // The payer name is checked on press, so a field never touched says what is missing instead of a
  // grey button (UX_MOBILE §2 "Nothing fails silently"). What else holds the button shows on screen.
  const sendEnabled = amountOk && txnOk && proof.kind !== 'uploading';

  const submit = () => {
    setNameTouched(true);
    if (!canSend || amountPaisa === null) return;
    send.mutate({
      amountPaisa: String(amountPaisa),
      payerName: name,
      payerChannel: channel,
      ...(txn ? { transactionId: txn } : {}),
      ...(proof.kind === 'uploaded' ? { proofFileId: proof.fileId } : {}),
    });
  };

  const addScreenshot = async () => {
    setProof({ kind: 'uploading' });
    try {
      const result = await pickAndUploadFile({ purpose: 'TOPUP_PROOF', quality: 0.5 });
      if (!mounted.current) return;
      if (result.status === 'uploaded') setProof({ kind: 'uploaded', fileId: result.file.fileId, uri: result.image.uri });
      else if (result.status === 'denied') setProof({ kind: 'denied' });
      else setProof({ kind: 'none' });
    } catch {
      if (mounted.current) setProof({ kind: 'failed' });
    }
  };

  const channels = (info.data?.payerChannels.length ? info.data.payerChannels : ALL_CHANNELS).filter((c) =>
    ALL_CHANNELS.includes(c),
  );

  return (
    <Screen
      footer={
        <Button
          label={t('topup.tellUs.submit')}
          onPress={submit}
          size="lg"
          loading={send.isPending}
          loadingLabel={t('topup.tellUs.sending')}
          disabled={!sendEnabled}
        />
      }
    >
      <StepHeader step={3} total={3} title={t('topup.tellUs.title')} />
      <View style={styles.stack}>
        <RupeeField
          label={t('topup.tellUs.amount')}
          value={amountText}
          onChangeText={setAmountText}
          maxLength={9}
          error={amountError ?? serverAmountError}
        />
        <Field
          label={t('topup.tellUs.payerName')}
          value={payerName}
          // Words are capitalised as they are typed ("ahmed raza" → "Ahmed Raza"), never on blur, so the
          // name, and with it the Idempotency-Key, can't change between a send and its retry.
          onChangeText={(value) => setPayerName(capitaliseWords(value))}
          onBlur={() => setNameTouched(true)}
          helper={t('topup.tellUs.payerNameHelp')}
          error={(nameTouched && !nameOk ? t('topup.tellUs.payerNameRequired') : null) ?? serverFields.payerName}
          autoCapitalize="words"
          autoComplete="name"
          maxLength={PAYER_NAME_MAX}
          returnKeyType="next"
        />
        <View style={styles.group}>
          <Text variant="label">{t('topup.tellUs.channel')}</Text>
          <SegmentedControl<PayerChannel>
            accessibilityLabel={t('topup.tellUs.channel')}
            options={channels.map((value) => ({ value, label: t(`topup.channel.${value}`) }))}
            value={channel}
            onChange={setChannel}
          />
        </View>
        <Field
          label={t('topup.tellUs.txnId')}
          optional
          value={transactionId}
          onChangeText={setTransactionId}
          helper={t('topup.tellUs.txnIdHelp')}
          error={!txnOk ? t('validation.INVALID_FORMAT') : serverFields.transactionId}
          autoCapitalize="characters"
          maxLength={TRANSACTION_ID_MAX}
        />

        <ScreenshotTile proof={proof} onAdd={() => void addScreenshot()} onRemove={() => setProof({ kind: 'none' })} />

        {/* A lost signal keeps every entry; "Send for checking" again reuses the same key. */}
        {bannerError ? <ErrorBanner error={offline ? t('topup.tellUs.notSent') : bannerError} /> : null}
      </View>
    </Screen>
  );
}

/** "Add screenshot": a spinner while uploading, a thumbnail with Remove, or "Upload failed. Try again.". */
function ScreenshotTile({ proof, onAdd, onRemove }: { proof: Proof; onAdd: () => void; onRemove: () => void }) {
  const { t } = useTranslation();

  if (proof.kind === 'uploaded') {
    return (
      <View style={[styles.tile, styles.tileDone]}>
        <Image source={{ uri: proof.uri }} style={styles.thumb} accessibilityLabel={t('topup.tellUs.screenshotA11y')} />
        <Text style={styles.flex}>{t('topup.tellUs.screenshotAdded')}</Text>
        <Button label={t('topup.tellUs.remove')} onPress={onRemove} variant="ghost" fullWidth={false} />
      </View>
    );
  }

  const uploading = proof.kind === 'uploading';
  return (
    <View style={styles.group}>
      <Pressable
        onPress={uploading ? undefined : onAdd}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel={uploading ? t('topup.tellUs.screenshotUploading') : t('topup.tellUs.screenshot')}
        accessibilityHint={t('topup.tellUs.screenshotHelp')}
        accessibilityState={{ busy: uploading, disabled: uploading }}
        android_ripple={{ color: colors.ripple }}
        style={styles.tile}
      >
        {uploading ? <ActivityIndicator color={colors.brand} /> : <Icon name="photo" size={32} tone="brand" />}
        <View style={styles.flex}>
          <Text variant="bodyStrong" tone="brand">
            {uploading ? t('topup.tellUs.screenshotUploading') : t('topup.tellUs.screenshot')}
          </Text>
          <Text variant="caption" tone="secondary">
            {t('topup.tellUs.screenshotHelp')}
          </Text>
        </View>
      </Pressable>
      {proof.kind === 'failed' ? <Text tone="danger">{t('common.upload.failed')}</Text> : null}
      {proof.kind === 'denied' ? <Text tone="danger">{t('common.upload.libraryDenied')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  group: { gap: space.sm },
  flex: { flex: 1 },
  tile: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tileDone: { borderStyle: 'solid', borderColor: colors.border },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.sunken },
});
