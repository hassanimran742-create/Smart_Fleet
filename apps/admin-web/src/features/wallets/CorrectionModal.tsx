import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CORRECTION_REASONS, type CorrectionDirection, type UUID, type WalletCorrectionResult } from '@smartfleet/shared-types';
import { formatNo, toAsciiDigits } from '@smartfleet/shared-utils';
import { CORRECTION_MAX_PAISA, walletCorrectionSchema } from '@smartfleet/shared-validation';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { errorDetails, messageFor, toApiError, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateTime, formatRs } from '../../i18n/format';
import {
  Button,
  Field,
  InlineAlert,
  Modal,
  MoneyInput,
  RadioCards,
  Select,
  Textarea,
  TextInput,
  useConfirm,
  useZodForm,
  type KeyValueItem,
} from '../../ui';
import { findRelatedRecord, useRecordCorrection, type RelatedRecord } from './api';

const NOTE_MAX = 300;
const LOOKUP_DEBOUNCE_MS = 400;

export interface CorrectionModalProps {
  distributorId: UUID;
  distributorName: string;
  /** The distributor's code, for typed numbers like 31 or T031 (written out as AG-T031). */
  distributorCode: string;
  /** The balance now, for the preview and the "can't take more" check (the server checks again). */
  balancePaisa: string;
  onClose: () => void;
  onSaved: (result: WalletCorrectionResult) => void;
  /** The server says the balance is different from what the page shows: refresh it. */
  onBalanceChanged: () => void;
}

type RelatedTarget =
  | { state: 'empty' }
  | { state: 'invalid' }
  | { state: 'notTheirs'; number: string }
  | { state: 'number'; kind: 'TOPUP' | 'ORDER'; shortCode: string };

const RELATED_NUMBER = /^(?:([A-Z][A-Z0-9]{1,5})-)?(T)?(\d{1,7})$/;

/** A typed top-up or order number of this distributor: "AG-T031", "T031", "AG-0142" or "142". */
function relatedTarget(text: string, code: string): RelatedTarget {
  const compact = toAsciiDigits(text).replace(/\s+/g, '').toUpperCase();
  if (!compact) return { state: 'empty' };
  const match = RELATED_NUMBER.exec(compact);
  if (!match) return { state: 'invalid' };
  if (match[1] && match[1] !== code.toUpperCase()) return { state: 'notTheirs', number: compact };
  const kind = match[2] ? 'TOPUP' : 'ORDER';
  return { state: 'number', kind, shortCode: formatNo(code, kind, Number(match[3])) };
}

/**
 * "Record correction" (UX_ADMIN §2.6, ADR-10): for genuine mistakes only. Direction (no default), an amount
 * up to Rs 100,000, a reason, an optional related top-up or order of this distributor (looked up as it is
 * typed, G01-02), a note of at least 10 characters, a balance preview and a confirm. It is sent with the
 * dialog's Idempotency-Key, so a retry is applied once.
 */
export function CorrectionModal({
  distributorId,
  distributorName,
  distributorCode,
  balancePaisa,
  onClose,
  onSaved,
  onBalanceChanged,
}: CorrectionModalProps) {
  const { t } = useTranslation(['wallets', 'common', 'validation', 'status']);
  const confirm = useConfirm();
  const save = useRecordCorrection(distributorId);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const relatedHintId = useId();
  const form = useZodForm(walletCorrectionSchema, {
    direction: undefined,
    amountPaisa: null,
    reasonCode: undefined,
    note: '',
  });
  const [relatedText, setRelatedText] = useState('');
  const [relatedServerError, setRelatedServerError] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const typed = useDebouncedValue(relatedText, LOOKUP_DEBOUNCE_MS);
  const target = relatedTarget(typed, distributorCode);
  const stillTyping = typed !== relatedText;
  const lookup = useQuery({
    queryKey: [...qk.wallets.all, 'related', distributorId, target.state === 'number' ? target.shortCode : ''] as const,
    queryFn: ({ signal }) =>
      target.state === 'number' ? findRelatedRecord(distributorId, target, signal) : Promise.resolve(null),
    enabled: target.state === 'number',
    staleTime: 60_000,
    retry: false,
  });

  const direction = form.values.direction as CorrectionDirection | undefined;
  const amount = typeof form.values.amountPaisa === 'string' && /^\d+$/.test(form.values.amountPaisa) ? BigInt(form.values.amountPaisa) : null;
  const balance = BigInt(balancePaisa);
  const tooMuch = direction === 'TAKE' && amount !== null && amount > balance;
  const after = direction && amount !== null && !tooMuch ? (direction === 'ADD' ? balance + amount : balance - amount) : null;

  const related: RelatedRecord | null = target.state === 'number' && lookup.data ? lookup.data : null;
  const relatedNumber = target.state === 'number' ? target.shortCode : target.state === 'notTheirs' ? target.number : relatedText.trim();
  const relatedChecking = relatedText.trim() !== '' && (stillTyping || (target.state === 'number' && lookup.isFetching));
  let relatedError: string | null = null;
  if (!relatedChecking) {
    if (target.state === 'invalid') {
      relatedError = t('correction.relatedInvalid', {
        topup: formatNo(distributorCode, 'TOPUP', 31),
        order: formatNo(distributorCode, 'ORDER', 142),
      });
    } else if (target.state === 'notTheirs' || relatedServerError || (target.state === 'number' && lookup.isSuccess && !lookup.data)) {
      relatedError = t('correction.relatedNotTheirs', { distributor: distributorName, number: relatedNumber });
    } else if (target.state === 'number' && lookup.isError) {
      relatedError = t('correction.relatedFailed');
    }
  }
  const relatedUnresolved = relatedText.trim() !== '' && related === null;

  const showError = (error: ApiError) => {
    const missing = errorDetails(error, 'NOT_FOUND');
    if (missing?.field === 'relatedPaymentId' || missing?.field === 'relatedOrderId') {
      setRelatedServerError(true);
      return;
    }
    if (error.is('WALLET_ADJUST_EXCEEDS_BALANCE')) {
      form.setServerError(error, { WALLET_ADJUST_EXCEEDS_BALANCE: 'amountPaisa' });
      onBalanceChanged();
      return;
    }
    if (error.isNetwork) {
      setTopError(t('correction.offline'));
      return;
    }
    if (error.fields.length > 0) {
      form.setServerError(error);
      return;
    }
    setTopError(messageFor(error));
  };

  const submit = form.handleSubmit(async (data) => {
    if (tooMuch || relatedChecking || relatedUnresolved) return;
    const body = {
      ...data,
      relatedPaymentId: related?.kind === 'TOPUP' ? related.id : undefined,
      relatedOrderId: related?.kind === 'ORDER' ? related.id : undefined,
    };
    const amountText = formatRs(body.amountPaisa);
    const facts: KeyValueItem[] = [
      { id: 'reason', label: t('correction.facts.reason'), value: t(`correction.reasons.${body.reasonCode}`) },
      { id: 'note', label: t('correction.facts.note'), value: body.note },
      ...(related ? [{ id: 'related', label: t('correction.facts.related'), value: related.shortCode }] : []),
      ...(after !== null ? [{ id: 'after', label: t('correction.facts.balance'), value: formatRs(after) }] : []),
    ];
    const adding = body.direction === 'ADD';
    const { ok } = await confirm({
      title: adding
        ? t('correction.confirmAddTitle', { amount: amountText, distributor: distributorName })
        : t('correction.confirmTakeTitle', { amount: amountText, distributor: distributorName }),
      facts,
      body: t('correction.confirmBody'),
      tone: adding ? 'default' : 'danger',
      confirmLabel: adding ? t('correction.confirmAdd', { amount: amountText }) : t('correction.confirmTake', { amount: amountText }),
    });
    if (!ok) return;
    setTopError(null);
    try {
      onSaved(await save.mutateAsync(body));
    } catch (error) {
      showError(toApiError(error));
    }
  });

  const busy = save.isPending;
  const directionError = form.errorFor('direction') ? t('validation:INVALID_CHOICE') : undefined;
  const reasonError = form.errorFor('reasonCode') ? t('validation:INVALID_CHOICE') : undefined;
  const continueReason = tooMuch ? t('correction.tooMuch', { distributor: distributorName, balance: formatRs(balance) }) : undefined;

  return (
    <Modal
      open
      size="md"
      className="sf-correction"
      title={t('correction.title', { distributor: distributorName })}
      description={t('correction.intro')}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>
            {t('common:actions.goBack')}
          </Button>
          <Button
            variant="primary"
            loading={busy || relatedChecking}
            disabled={tooMuch}
            disabledReason={continueReason}
            onClick={() => submit()}
          >
            {t('correction.continue')}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(event);
        }}
      >
        <Field label={t('correction.direction')} error={directionError}>
          <RadioCards
            name="direction"
            columns={2}
            options={[
              { value: 'ADD', label: t('correction.add') },
              { value: 'TAKE', label: t('correction.take') },
            ]}
            value={direction ?? null}
            onChange={(value) => form.setValue('direction', value)}
          />
        </Field>

        <Field
          label={t('correction.amount')}
          hint={t('correction.amountHint', { max: formatRs(CORRECTION_MAX_PAISA) })}
          error={form.errorFor('amountPaisa')}
        >
          <MoneyInput
            name="amountPaisa"
            valuePaisa={typeof form.values.amountPaisa === 'string' ? form.values.amountPaisa : null}
            max={CORRECTION_MAX_PAISA}
            onChange={(value) => form.setValue('amountPaisa', value)}
            onBlur={() => form.touch('amountPaisa')}
            disabled={busy}
          />
        </Field>

        {tooMuch ? (
          <InlineAlert tone="danger" live>
            {t('correction.tooMuch', { distributor: distributorName, balance: formatRs(balance) })}
          </InlineAlert>
        ) : after !== null ? (
          <p className="sf-correction__preview" aria-live="polite">
            {t('correction.preview', { from: formatRs(balance), to: formatRs(after) })}
          </p>
        ) : null}

        <Field label={t('correction.reason')} error={reasonError}>
          <Select
            name="reasonCode"
            value={typeof form.values.reasonCode === 'string' ? form.values.reasonCode : ''}
            placeholder={t('correction.reasonPlaceholder')}
            options={CORRECTION_REASONS.map((code) => ({ value: code, label: t(`correction.reasons.${code}`) }))}
            onChange={(event) =>
              form.setValue('reasonCode', (event.target.value || undefined) as (typeof CORRECTION_REASONS)[number] | undefined)
            }
            onBlur={() => form.touch('reasonCode')}
            disabled={busy}
          />
        </Field>

        <Field
          label={t('correction.related')}
          optional
          hint={t('correction.relatedHint', { distributor: distributorName })}
          error={relatedError}
        >
          <TextInput
            mono
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            placeholder={t('correction.relatedPlaceholder')}
            value={relatedText}
            aria-describedby={relatedHintId}
            onChange={(event) => {
              setRelatedText(event.target.value);
              setRelatedServerError(false);
            }}
            disabled={busy}
          />
        </Field>
        <div id={relatedHintId} className="sf-correction__related" aria-live="polite">
          {relatedChecking ? (
            <span className="sf-correction__muted">{t('correction.relatedChecking')}</span>
          ) : related && !relatedServerError ? (
            <span className="sf-correction__found">{relatedLine(related, t)}</span>
          ) : target.state === 'number' && lookup.isError ? (
            <Button size="sm" variant="ghost" onClick={() => void lookup.refetch()}>
              {t('correction.relatedRetry')}
            </Button>
          ) : null}
        </div>

        <Field label={t('correction.note')} hint={t('correction.noteHint')} error={form.errorFor('note')}>
          <Textarea
            name="note"
            maxLength={NOTE_MAX}
            value={typeof form.values.note === 'string' ? form.values.note : ''}
            onChange={(event) => form.setValue('note', event.target.value)}
            onBlur={() => form.touch('note')}
            disabled={busy}
          />
        </Field>

        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        {topError ? (
          <InlineAlert tone="danger" live>
            {topError}
          </InlineAlert>
        ) : null}
      </form>
    </Modal>
  );
}

function relatedLine(related: RelatedRecord, t: TFunction<['wallets', 'common', 'validation', 'status']>): string {
  if (related.kind === 'TOPUP') {
    return t('correction.relatedTopup', {
      no: related.shortCode,
      amount: formatRs(related.payment.creditedPaisa ?? related.payment.amountPaisa),
      status: t(`status:topup.${related.payment.stage}`),
    });
  }
  return t('correction.relatedOrder', {
    no: related.shortCode,
    customer: related.order.client.name,
    when: formatDateTime(related.order.createdAt),
  });
}
