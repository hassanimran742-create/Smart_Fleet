import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentDto } from '@smartfleet/shared-types';
import { formatRs } from '@smartfleet/shared-utils';
import { topupRequestSchema } from '@smartfleet/shared-validation';
import { useIdempotencyKey } from '../../../api/client';
import { fieldErrorsOf, type ApiError } from '../../../api/errors';
import { invalidate, qk } from '../../../api/keys';
import { pickAndUploadFile } from '../../../api/upload';
import {
  ActionLine,
  AddMore,
  Button,
  colors,
  Field,
  Icon,
  radius,
  Screen,
  sizes,
  space,
  StepHeader,
  Text,
  useToast,
} from '../../../ui';
import { fetchMyTopups, sendTopupRequest, type TopupRequestBody } from '../shared/api';
import { capitaliseWords, paisaOrZero } from '../shared/format';
import { showSentTopup, useFormGuard, useShopNavigation, useShopRoute } from '../shared/navigation';

const PAYER_NAME_MAX = 60;
const TRANSACTION_ID_MAX = 40;

type Proof =
  | { kind: 'none' }
  | { kind: 'uploading' }
  | { kind: 'uploaded'; fileId: string; uri: string }
  | { kind: 'failed' }
  | { kind: 'denied' };

/** The body fields this form shows a server field error on; anything else is the footer line. */
const FIELD_PATHS: ReadonlySet<string> = new Set(['payerName', 'transactionId']);

/**
 * S5 Add money, step 3 of 3 (shop spec §H): the amount and channel carried from steps 1 and 2, the
 * name on the account (prefilled from the last top-up, its helper following the channel), an
 * optional screenshot, and the transaction ID behind "+ Add more". Sends `POST /payments/topup-requests`
 * with this intent's Idempotency-Key, so "Send for checking" tapped again after a lost signal makes
 * exactly one request ("Not sent. Tap again. It won't be sent twice."). A failed upload never blocks
 * sending. On success the status screen replaces the flow and says "Sent for checking".
 */
export function TopupTellUsScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { params } = useShopRoute<'TopupTellUs'>();
  const channel = params.payerChannel;
  // The last name used, unless "Tell us again" brought one.
  const mine = useQuery<PaymentDto[], ApiError>({
    queryKey: qk.topups.mine,
    queryFn: fetchMyTopups,
    enabled: !params.payerName,
  });

  const [payerName, setPayerName] = useState(params.payerName ?? '');
  const [nameTouched, setNameTouched] = useState(false);
  const [transactionId, setTransactionId] = useState('');
  const [txnTouched, setTxnTouched] = useState(false);
  const [proof, setProof] = useState<Proof>({ kind: 'none' });
  const initialName = useRef((params.payerName ?? '').trim());
  const nameEdited = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // Prefill the name from the newest top-up that has one, until the person types.
  const lastName = mine.data?.find((payment) => payment.payerName)?.payerName ?? null;
  useEffect(() => {
    if (params.payerName || nameEdited.current || !lastName) return;
    const name = capitaliseWords(lastName.trim());
    initialName.current = name;
    setPayerName(name);
  }, [lastName, params.payerName]);

  const amountPaisa = paisaOrZero(params.amountPaisa);
  const name = payerName.trim();
  const txn = transactionId.trim();

  // One key per intent: the same amount, name and channel keep it across retries (API_CONTRACT §4.2).
  // The amount and channel can't change here, so a retry always reuses it.
  const idem = useIdempotencyKey([amountPaisa, name, channel]);
  const guard = useFormGuard(name !== initialName.current || txn !== '' || proof.kind === 'uploaded');

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
  const nameOk = topupRequestSchema.shape.payerName.safeParse(name).success;
  const txnOk = txn === '' || topupRequestSchema.shape.transactionId.safeParse(txn).success;
  const amountOk = amountPaisa > 0;

  const serverError = send.error;
  const serverFields = serverError ? fieldErrorsOf(serverError, t) : {};
  const fieldPaths = Object.keys(serverFields);
  // Field problems are shown on their fields; everything else is the line above the button.
  const lineError =
    serverError &&
    !(serverError.code === 'VALIDATION_FAILED' && fieldPaths.length > 0 && fieldPaths.every((path) => FIELD_PATHS.has(path)))
      ? serverError
      : null;

  const canSend = amountOk && nameOk && txnOk && proof.kind !== 'uploading' && !send.isPending;
  // Enabled whenever no upload is running: the name and the transaction ID are checked on press, so a
  // field never touched says what is missing instead of a grey button (UX_MOBILE §2).
  const sendEnabled = amountOk && proof.kind !== 'uploading';

  const submit = () => {
    setNameTouched(true);
    setTxnTouched(true);
    if (!canSend) return;
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

  return (
    <Screen
      footer={
        <>
          {/* A lost signal keeps every entry; "Send for checking" again reuses the same key. */}
          <ActionLine error={lineError} notSentLabel={t('topup.tellUs.notSent')} />
          <Button
            label={t('topup.tellUs.submit')}
            onPress={submit}
            size="lg"
            loading={send.isPending}
            loadingLabel={t('topup.tellUs.sending')}
            disabled={!sendEnabled}
          />
        </>
      }
    >
      <StepHeader step={3} total={3} title={t('topup.tellUs.title')} />
      <View style={styles.stack}>
        <Text variant="heading">
          {t('topup.tellUs.summary', { amount: formatRs(params.amountPaisa), channel: t(`topup.channel.${channel}`) })}
        </Text>
        <Field
          label={t('topup.tellUs.payerName')}
          value={payerName}
          // Words are capitalised as they are typed ("ahmed raza" → "Ahmed Raza"), never on blur, so the
          // name, and with it the Idempotency-Key, can't change between a send and its retry.
          onChangeText={(value) => {
            nameEdited.current = true;
            setPayerName(capitaliseWords(value));
          }}
          onBlur={() => setNameTouched(true)}
          helper={t(`topup.tellUs.payerNameHelp.${channel}`)}
          error={(nameTouched && !nameOk ? t('topup.tellUs.payerNameRequired') : null) ?? serverFields.payerName}
          autoCapitalize="words"
          autoComplete="name"
          maxLength={PAYER_NAME_MAX}
          returnKeyType="done"
        />

        <ScreenshotTile proof={proof} onAdd={() => void addScreenshot()} onRemove={() => setProof({ kind: 'none' })} />

        <AddMore open={txn !== '' || !!serverFields.transactionId}>
          <Field
            label={t('topup.tellUs.txnId')}
            value={transactionId}
            onChangeText={setTransactionId}
            onBlur={() => setTxnTouched(true)}
            error={(txnTouched && !txnOk ? t('topup.tellUs.txnIdInvalid') : null) ?? serverFields.transactionId}
            autoCapitalize="characters"
            maxLength={TRANSACTION_ID_MAX}
          />
        </AddMore>
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
        <Text variant="bodyStrong" tone="brand" style={styles.flex}>
          {uploading ? t('topup.tellUs.screenshotUploading') : t('topup.tellUs.screenshot')}
        </Text>
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
