import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as LinkIcon, Minus, Plus } from 'lucide-react';
import {
  CORRECTION_REASONS,
  type CorrectionDirection,
  type CorrectionReason,
  type OrderDto,
  type PaymentDto,
  type UUID,
  type WalletCorrectionResult,
} from '@smartfleet/shared-types';
import { formatNo, formatPkDay, toAsciiDigits } from '@smartfleet/shared-utils';
import { CORRECTION_MAX_PAISA, parseRequest, walletCorrectionSchema } from '@smartfleet/shared-validation';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { errorDetails, fieldMessage, messageFor, toApiError, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatRs } from '../../i18n/format';
import {
  AddMore,
  Button,
  Field,
  InlineAlert,
  KeyValueList,
  Modal,
  MoneyInput,
  RadioCards,
  SearchSelect,
  Textarea,
  type KeyValueItem,
  type SearchSelectOption,
} from '../../ui';
import { findRelatedRecord, useRecordCorrection, useRelatedChoices, type RelatedRecord } from './api';

/** The note is the audit trail for money: 10–300 characters (settled point O2, kept by DECIDED.md). */
const NOTE_MIN = 10;
const NOTE_MAX = 300;
/** Rs 1, the smallest correction (whole rupees). */
const AMOUNT_MIN_PAISA = 100;
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

type TypedNumber =
  | { state: 'none' }
  | { state: 'notTheirs'; number: string }
  | { state: 'number'; kind: 'TOPUP' | 'ORDER'; shortCode: string };

const RELATED_NUMBER = /^(?:([A-Z][A-Z0-9]{1,5})-)?(T)?(\d{1,7})$/;

/** A typed top-up or order number: "AG-T031", "T031", "AG-0142" or "142"; another distributor's code is named. */
function typedNumber(text: string, code: string): TypedNumber {
  const compact = toAsciiDigits(text).replace(/\s+/g, '').toUpperCase();
  const match = compact ? RELATED_NUMBER.exec(compact) : null;
  if (!match) return { state: 'none' };
  if (match[1] && match[1] !== code.toUpperCase()) return { state: 'notTheirs', number: compact };
  const kind = match[2] ? 'TOPUP' : 'ORDER';
  return { state: 'number', kind, shortCode: formatNo(code, kind, Number(match[3])) };
}

const valueOf = (record: RelatedRecord) => `${record.kind}:${record.id}`;

function topupRecord(payment: PaymentDto): RelatedRecord {
  return { kind: 'TOPUP', id: payment.id, shortCode: payment.shortCode, payment };
}

function orderRecord(order: OrderDto): RelatedRecord {
  return { kind: 'ORDER', id: order.id, shortCode: order.shortCode, order };
}

/** "AG-T031 · Rs 5,000 · Approved" or "AG-0142 · Sana · 21 Oct". */
function recordLine(record: RelatedRecord, t: TFunction<['wallets', 'common', 'status', 'validation']>): string {
  if (record.kind === 'TOPUP') {
    return t('correction.relatedTopup', {
      no: record.shortCode,
      amount: formatRs(record.payment.creditedPaisa ?? record.payment.amountPaisa),
      status: t(`status:topup.${record.payment.stage}`),
    });
  }
  return t('correction.relatedOrder', {
    no: record.shortCode,
    customer: record.order.client.name,
    when: formatPkDay(record.order.createdAt, { weekday: false }),
  });
}

/** Every typed word appears in the row, ignoring case (SearchSelect's own rule). */
function hasWords(option: SearchSelectOption, query: string): boolean {
  const haystack = `${option.label} ${option.description ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

type Problems = Partial<Record<'direction' | 'amount' | 'reason' | 'note', string>>;

/**
 * "Record correction…" (website spec W14, ADR-10): for mistakes only. Step 1 is the form: add or take
 * (no default), the amount, the reason, a required note of 10+ characters and, behind "+ Link a top-up
 * or order", one of this distributor's top-ups or orders. Step 2, in the same dialog, is the
 * confirmation: no dialog stacks on another. It is sent with the dialog's one Idempotency-Key, so a
 * double click or a retry is applied once.
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
  const { t } = useTranslation(['wallets', 'common', 'status', 'validation']);
  const save = useRecordCorrection(distributorId);
  const formRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [direction, setDirection] = useState<CorrectionDirection | null>(null);
  const [amountPaisa, setAmountPaisa] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [reasonCode, setReasonCode] = useState<CorrectionReason | null>(null);
  const [note, setNote] = useState('');
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [picked, setPicked] = useState<RelatedRecord | null>(null);
  const [query, setQuery] = useState('');
  const [pressed, setPressed] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<'amount' | 'note' | 'related', string>>>({});
  const [stepError, setStepError] = useState<string | null>(null);

  // ---- The linked record: the latest 10 top-ups and orders, plus a full number typed that isn't listed.
  const latest = useRelatedChoices(distributorId, distributorName, relatedOpen);
  const typedText = useDebouncedValue(query, LOOKUP_DEBOUNCE_MS);
  const typed = typedNumber(typedText, distributorCode);
  const listed = useMemo(
    () => [...(latest.data?.topups ?? []).map(topupRecord), ...(latest.data?.orders ?? []).map(orderRecord)],
    [latest.data],
  );
  const wanted = typed.state === 'number' ? typed.shortCode : null;
  const wantedListed = wanted !== null && listed.some((record) => record.shortCode.toUpperCase() === wanted);
  const lookup = useQuery({
    queryKey: [...qk.wallets.all, 'related', distributorId, wanted ?? ''] as const,
    queryFn: ({ signal }) =>
      typed.state === 'number' ? findRelatedRecord(distributorId, typed, signal) : Promise.resolve(null),
    enabled: relatedOpen && typed.state === 'number' && !wantedListed,
    staleTime: 60_000,
    retry: false,
  });

  const records = useMemo(() => {
    const all = [...listed];
    for (const extra of [lookup.data ?? null, picked]) {
      if (extra && !all.some((record) => record.id === extra.id)) all.unshift(extra);
    }
    return all;
  }, [listed, lookup.data, picked]);
  const byValue = useMemo(() => new Map(records.map((record) => [valueOf(record), record])), [records]);
  const options = useMemo<SearchSelectOption[]>(
    () => records.map((record) => ({ value: valueOf(record), label: recordLine(record, t) })),
    [records, t],
  );

  const stillTyping = typedText !== query;
  let relatedError: string | null = serverErrors.related ?? null;
  if (!relatedError && query.trim() && !stillTyping) {
    if (typed.state === 'notTheirs') {
      relatedError = t('correction.relatedNotTheirs', { distributor: distributorName, number: typed.number });
    } else if (typed.state === 'number' && !wantedListed && lookup.isSuccess && !lookup.data) {
      relatedError = t('correction.relatedNotTheirs', { distributor: distributorName, number: typed.shortCode });
    } else if (typed.state === 'number' && lookup.isError) {
      relatedError = t('correction.relatedFailed');
    }
  }

  // ---- The amount, its limit by direction and the preview.
  const balance = BigInt(balancePaisa);
  const amount = amountPaisa !== null && /^\d+$/.test(amountPaisa) ? BigInt(amountPaisa) : null;
  const limit = BigInt(CORRECTION_MAX_PAISA);
  const takeLimit = balance < 0n ? 0n : balance < limit ? balance : limit;
  const tooMuch = direction === 'TAKE' && amount !== null && amount > balance;
  const inLimits = amount !== null && amount >= BigInt(AMOUNT_MIN_PAISA) && amount <= limit;
  const after = direction && inLimits && !tooMuch && amount !== null ? (direction === 'ADD' ? balance + amount : balance - amount) : null;

  let amountError: string | null = serverErrors.amount ?? null;
  if (!amountError) {
    if (amount === null) {
      // A typed decimal shows MoneyInput's own "Whole rupees only".
      amountError = pressed && amountText.trim() === '' ? t('correction.amountMissing') : null;
    } else if (amount > limit) {
      amountError = t('validation:AMOUNT_TOO_LARGE', { max: formatRs(limit) });
    } else if (tooMuch) {
      amountError = t('correction.tooMuch', { distributor: distributorName, balance: formatRs(balance) });
    } else if (amount < BigInt(AMOUNT_MIN_PAISA) && pressed) {
      amountError = t('validation:AMOUNT_TOO_SMALL', { min: formatRs(AMOUNT_MIN_PAISA) });
    }
  }

  const problems: Problems = {
    direction: direction === null ? t('correction.pickDirection') : undefined,
    amount: amount === null || !inLimits || tooMuch || serverErrors.amount ? (amountError ?? '') : undefined,
    reason: reasonCode === null ? t('correction.pickReason') : undefined,
    note: serverErrors.note ?? (note.trim().length < NOTE_MIN ? t('correction.noteMissing', { min: NOTE_MIN }) : undefined),
  };

  // Only a step change moves the focus: to Back on the confirmation, to Continue when back on the form.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    (step === 'confirm' ? backRef : continueRef).current?.focus();
  }, [step]);

  // The form's main button stays pressable (website spec §1.7): with a gap, each field says what is
  // missing and the first one gets the focus; otherwise step 2 asks to confirm.
  const onContinue = () => {
    setPressed(true);
    setStepError(null);
    const order: Array<[keyof Problems, string]> = [
      ['direction', 'input[name="direction"]'],
      ['amount', 'input[name="amountPaisa"]'],
      ['reason', 'input[name="reasonCode"]'],
      ['note', 'textarea[name="note"]'],
    ];
    const first = order.find(([key]) => problems[key] !== undefined);
    if (first) {
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(first[1])?.focus());
      return;
    }
    setStep('confirm');
  };

  const showError = (error: ApiError) => {
    const missing = errorDetails(error, 'NOT_FOUND');
    if (missing?.field === 'relatedPaymentId' || missing?.field === 'relatedOrderId') {
      setServerErrors((prev) => ({
        ...prev,
        related: t('correction.relatedNotTheirs', { distributor: distributorName, number: picked?.shortCode ?? '' }),
      }));
      setStep('form');
      return;
    }
    if (error.is('WALLET_ADJUST_EXCEEDS_BALANCE')) {
      setServerErrors((prev) => ({ ...prev, amount: messageFor(error) }));
      onBalanceChanged();
      setStep('form');
      return;
    }
    if (error.isNetwork) {
      setStepError(t('correction.offline'));
      return;
    }
    const amountField = error.fields.find((field) => field.path === 'amountPaisa');
    const noteField = error.fields.find((field) => field.path === 'note');
    if (amountField || noteField) {
      setServerErrors((prev) => ({
        ...prev,
        ...(amountField ? { amount: fieldMessage(amountField) } : {}),
        ...(noteField ? { note: fieldMessage(noteField) } : {}),
      }));
      setStep('form');
      return;
    }
    setStepError(messageFor(error));
  };

  const confirmSave = async () => {
    setStepError(null);
    const parsed = parseRequest(walletCorrectionSchema, {
      direction: direction ?? undefined,
      amountPaisa,
      reasonCode: reasonCode ?? undefined,
      note: note.trim(),
      relatedPaymentId: picked?.kind === 'TOPUP' ? picked.id : undefined,
      relatedOrderId: picked?.kind === 'ORDER' ? picked.id : undefined,
    });
    if (!parsed.success) {
      setStep('form');
      return;
    }
    try {
      onSaved(await save.mutateAsync(parsed.data));
    } catch (error) {
      showError(toApiError(error));
    }
  };

  const busy = save.isPending;
  const adding = direction === 'ADD';
  const amountWords = amount !== null ? formatRs(amount) : '';
  const facts: KeyValueItem[] =
    step === 'confirm' && reasonCode
      ? [
          { id: 'reason', label: t('correction.facts.reason'), value: t(`correction.reasons.${reasonCode}`) },
          { id: 'note', label: t('correction.facts.note'), value: note.trim() },
          ...(picked ? [{ id: 'related', label: t('correction.facts.related'), value: picked.shortCode }] : []),
          ...(after !== null ? [{ id: 'after', label: t('correction.facts.balance'), value: formatRs(after) }] : []),
        ]
      : [];

  const title =
    step === 'confirm'
      ? adding
        ? t('correction.confirmAddTitle', { amount: amountWords, distributor: distributorName })
        : t('correction.confirmTakeTitle', { amount: amountWords, distributor: distributorName })
      : t('correction.title', { distributor: distributorName });

  return (
    <Modal
      open
      size="md"
      className="sf-correction"
      title={title}
      description={step === 'form' ? t('correction.intro') : undefined}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      footer={
        step === 'form' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common:actions.goBack')}
            </Button>
            <Button ref={continueRef} variant="primary" onClick={onContinue}>
              {t('correction.continue')}
            </Button>
          </>
        ) : (
          <>
            <Button ref={backRef} variant="secondary" onClick={() => setStep('form')} disabled={busy}>
              {t('common:actions.back')}
            </Button>
            <Button variant={adding ? 'primary' : 'danger'} loading={busy} onClick={() => void confirmSave()}>
              {adding
                ? t('correction.confirmAdd', { amount: amountWords })
                : t('correction.confirmTake', { amount: amountWords })}
            </Button>
          </>
        )
      }
    >
      {/* Step 1 stays mounted while step 2 shows, so Back returns to it with everything kept. */}
      <div ref={formRef} hidden={step !== 'form'}>
        <Field label={t('correction.direction')} labelHidden error={pressed ? (problems.direction ?? null) : null}>
          <RadioCards
            name="direction"
            columns={2}
            options={[
              {
                value: 'ADD',
                label: (
                  <span className="sf-correction__direction">
                    <Plus aria-hidden size={16} strokeWidth={2.25} />
                    {t('correction.add')}
                  </span>
                ),
              },
              {
                value: 'TAKE',
                label: (
                  <span className="sf-correction__direction">
                    <Minus aria-hidden size={16} strokeWidth={2.25} />
                    {t('correction.take')}
                  </span>
                ),
              },
            ]}
            value={direction}
            onChange={(value) => {
              setDirection(value);
              setServerErrors(({ amount: _drop, ...rest }) => rest);
            }}
          />
        </Field>

        <Field
          label={t('correction.amount')}
          hint={
            direction === 'TAKE'
              ? t('correction.amountHintTake', { max: formatRs(takeLimit) })
              : t('correction.amountHint', { max: formatRs(limit) })
          }
          error={amountError}
        >
          <MoneyInput
            name="amountPaisa"
            valuePaisa={amountPaisa}
            max={CORRECTION_MAX_PAISA}
            onChange={(value) => {
              setAmountPaisa(value);
              setServerErrors(({ amount: _drop, ...rest }) => rest);
            }}
            onInput={(event) => setAmountText(event.currentTarget.value)}
            disabled={busy}
          />
        </Field>
        {after !== null ? (
          <p className="sf-correction__preview" aria-live="polite">
            {t('correction.preview', { from: formatRs(balance), to: formatRs(after) })}
          </p>
        ) : null}

        <Field label={t('correction.reason')} error={pressed ? (problems.reason ?? null) : null}>
          <RadioCards
            name="reasonCode"
            columns={2}
            options={CORRECTION_REASONS.map((code) => ({ value: code, label: t(`correction.reasons.${code}`) }))}
            value={reasonCode}
            onChange={setReasonCode}
          />
        </Field>

        <Field label={t('correction.note')} error={pressed ? (problems.note ?? null) : null}>
          <Textarea
            name="note"
            rows={3}
            maxLength={NOTE_MAX}
            placeholder={t('correction.notePlaceholder')}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setServerErrors(({ note: _drop, ...rest }) => rest);
            }}
            disabled={busy}
          />
        </Field>

        <AddMore label={t('correction.addRelated')} icon={LinkIcon} open={relatedOpen} onOpenChange={setRelatedOpen}>
          <Field label={t('correction.related')} error={relatedError}>
            <SearchSelect
              options={options}
              value={picked ? valueOf(picked) : null}
              onChange={(value) => {
                setPicked(value ? (byValue.get(value) ?? null) : null);
                setServerErrors(({ related: _drop, ...rest }) => rest);
              }}
              onQueryChange={setQuery}
              placeholder={t('correction.relatedPlaceholder')}
              loading={latest.isPending || (typed.state === 'number' && !wantedListed && lookup.isFetching)}
              filter={(option, text) =>
                hasWords(option, text) || (wanted !== null && byValue.get(option.value)?.shortCode.toUpperCase() === wanted)
              }
              disabled={busy}
            />
          </Field>
        </AddMore>
      </div>

      {step === 'confirm' ? (
        <>
          <KeyValueList items={facts} />
          {stepError ? (
            <InlineAlert tone="danger" live>
              {stepError}
            </InlineAlert>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
