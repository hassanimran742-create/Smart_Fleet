import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { PaymentDto, TopupApproveResult } from '@smartfleet/shared-types';
import { approveTopupSchema, BANK_TIME_MAX_AHEAD_MS, parseRequest } from '@smartfleet/shared-validation';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { errorDetails, messageFor, toApiError, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { useCloseDrawer } from '../../app/drawer';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { formatDateTime, formatDay, formatRs, formatTime, formatWait } from '../../i18n/format';
import {
  Button,
  CopyButton,
  DateTimeInput,
  Drawer,
  ErrorState,
  Field,
  InlineAlert,
  KeyValueList,
  MoneyInput,
  SkeletonText,
  StatusChip,
  TextInput,
  useConfirm,
  useToast,
  useZodForm,
  type KeyValueItem,
} from '../../ui';
import { RecordActivity } from '../activity';
import { type ActionAnswer, type TopupRules, useApproveTopup, useInvalidateAfterTopup, useTopup, useTopupRules } from './api';
import { ProofViewer } from './ProofViewer';
import { RejectModal } from './RejectModal';
import { channelWords } from './words';
import './topups.css';

const route = getRouteApi('/topups/$paymentId');

/** The audit rows of a top-up request (api-money writes `resourceType: 'Payment'`). */
const PAYMENT_RESOURCE = 'Payment';
const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE_MAX = 100;

/** Codes the API answers about one bank field, shown under that field (UX_ADMIN §2.2 Errors). */
const FIELD_CODES = {
  TOPUP_BANK_REFERENCE_USED: 'bankReference',
  TOPUP_BANK_REFERENCE_REQUIRED: 'bankReference',
  TOPUP_AMOUNT_TOO_SMALL: 'bankAmountPaisa',
  TOPUP_AMOUNT_TOO_LARGE: 'bankAmountPaisa',
  AMOUNT_NOT_WHOLE_RUPEES: 'bankAmountPaisa',
  TOPUP_BANK_TIME_IN_FUTURE: 'bankTime',
} as const;

/**
 * The review drawer (`/topups/$paymentId`, UX_ADMIN §2.2). It re-polls every 10 seconds: when another
 * office user approves or rejects the request meanwhile, it says so and locks.
 */
export function TopupDrawer() {
  const { t } = useTranslation(['topups', 'nav']);
  const { paymentId } = route.useParams();
  const close = useCloseDrawer();
  const query = useTopup(paymentId);

  if (query.isPending) {
    return (
      <Drawer title={t('nav:pages.topup')} width="lg" onClose={close}>
        <SkeletonText lines={8} />
      </Drawer>
    );
  }
  if (!query.data) {
    return (
      <Drawer title={t('nav:pages.topup')} width="lg" onClose={close}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} title={t('drawer.loadFailed')} />
      </Drawer>
    );
  }
  return <TopupReview key={query.data.id} payment={query.data} onClose={close} refetch={query.refetch} />;
}

interface ReviewProps {
  payment: PaymentDto;
  onClose: () => void;
  refetch: () => Promise<{ data?: PaymentDto }>;
}

interface Notice {
  tone: 'info' | 'danger';
  text: string;
}

/** "Sana approved this at 4:21 pm." from a request (or a TOPUP_NOT_PENDING's details). */
function handledText(
  t: TFunction<['topups', 'nav']>,
  status: string,
  reviewedBy: { name: string } | null | undefined,
  reviewedAt: string | null | undefined,
): string | null {
  const approved = status === 'SUCCESS';
  const rejected = status === 'REJECTED' || status === 'FAILED';
  if (!approved && !rejected) return null;
  const time = reviewedAt ? (sameKarachiDay(reviewedAt, Date.now()) ? formatTime(reviewedAt) : formatDateTime(reviewedAt)) : '';
  const name = reviewedBy?.name?.trim();
  if (approved) return name ? t('drawer.handled.approved', { name, time }) : t('drawer.handled.approvedNoName', { time });
  return name ? t('drawer.handled.rejected', { name, time }) : t('drawer.handled.rejectedNoName', { time });
}

function TopupReview({ payment, onClose, refetch }: ReviewProps) {
  const { t } = useTranslation(['topups', 'nav']);
  const toast = useToast();
  const confirm = useConfirm();
  const me = useMe();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAfterTopup();
  const { rules, error: rulesError, retry: retryRules, retrying: retryingRules } = useTopupRules();
  const approve = useApproveTopup(payment.id);
  const now = useNow(30_000);
  const form = useZodForm(approveTopupSchema, { bankReference: '', bankAmountPaisa: null, bankTime: undefined });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [viewingProof, setViewingProof] = useState(false);
  const acted = useRef(false);
  const openedPending = useRef(payment.status === 'PENDING');

  const distributor = payment.distributor?.businessName ?? '';
  const pending = payment.status === 'PENDING';

  // A re-poll shows the request was approved or rejected elsewhere: say who, and the form locks.
  useEffect(() => {
    if (!openedPending.current || pending || acted.current) return;
    const text = handledText(t, payment.status, payment.reviewedBy, payment.reviewedAt);
    if (text) setNotice({ tone: 'info', text });
    void queryClient.invalidateQueries({ queryKey: qk.activity.all });
    void queryClient.invalidateQueries({ queryKey: qk.topups.all });
  }, [pending, payment.status, payment.reviewedAt, payment.reviewedBy, queryClient, t]);

  const sentAt = sameKarachiDay(payment.createdAt, now) ? formatTime(payment.createdAt) : formatDateTime(payment.createdAt);
  const subtitle = pending
    ? t('drawer.subtitleWaiting', { no: payment.shortCode, time: sentAt, wait: formatWait(payment.createdAt, now) })
    : t('drawer.subtitle', { no: payment.shortCode, time: sentAt });

  const check = checkBankDetails(form.values, payment, rules, now);
  const creditPaisa = check.bankAmountPaisa ?? payment.amountPaisa;
  const amountText = formatRs(creditPaisa);
  const blocked = check.mismatch && rules?.onAmountMismatch === 'REJECT';

  const showServerError = (error: ApiError) => {
    const notPending = errorDetails(error, 'TOPUP_NOT_PENDING');
    if (notPending) {
      setNotice({ tone: 'info', text: handledText(t, notPending.status, notPending.reviewedBy, notPending.reviewedAt) ?? messageFor(error) });
      void refetch();
      void invalidate();
      return;
    }
    if (error.isNetwork) {
      setNotice({ tone: 'danger', text: t('drawer.offline') });
      return;
    }
    if (error.code in FIELD_CODES || error.fields.length > 0) {
      form.setServerError(error, FIELD_CODES);
      setNotice(null);
      return;
    }
    if (error.is('TOPUP_AMOUNT_MISMATCH')) void queryClient.invalidateQueries({ queryKey: qk.settings.all });
    setNotice({ tone: 'danger', text: messageFor(error) });
  };

  const finishApproval = async (answer: ActionAnswer<TopupApproveResult>) => {
    acted.current = true;
    const { payment: approved, wallet } = answer.data;
    await invalidate();
    const byMe = approved.reviewedBy?.id !== undefined && approved.reviewedBy.id === me.data?.id;
    if (answer.alreadyApplied && !byMe) {
      // Another office user approved it with this same reference first: nothing more was added.
      setNotice({ tone: 'info', text: handledText(t, approved.status, approved.reviewedBy, approved.reviewedAt) ?? '' });
      void refetch();
      return;
    }
    toast.success(
      t('drawer.added', {
        amount: formatRs(approved.creditedPaisa ?? creditPaisa),
        distributor,
        balance: formatRs(wallet.balancePaisa),
      }),
    );
    onClose();
  };

  const onApprove = async () => {
    const parsed = parseRequest(approveTopupSchema, form.values);
    if (!parsed.success || !check.ready || blocked) {
      form.handleSubmit(() => undefined)();
      return;
    }
    const body = { bankReference: parsed.data.bankReference, bankAmountPaisa: parsed.data.bankAmountPaisa, bankTime: parsed.data.bankTime };
    const facts: KeyValueItem[] = [
      { id: 'reference', label: t('confirm.reference'), value: <span className="sf-topups__mono">{body.bankReference}</span> },
      { id: 'amount', label: t('confirm.bankAmount'), value: formatRs(body.bankAmountPaisa) },
      { id: 'time', label: t('confirm.bankTime'), value: formatDateTime(body.bankTime) },
    ];
    if (check.mismatch) facts.push({ id: 'asked', label: t('confirm.asked'), value: formatRs(payment.amountPaisa) });
    const amount = formatRs(body.bankAmountPaisa);
    const { ok } = await confirm({
      title: t('confirm.title', { amount, distributor }),
      facts,
      body: t('confirm.body'),
      confirmLabel: t('confirm.yes', { amount }),
    });
    if (!ok) return;
    setNotice(null);
    try {
      await finishApproval(await approve.mutateAsync(body));
    } catch (error) {
      showServerError(toApiError(error));
    }
  };

  const onRejected = async (answer: ActionAnswer<{ payment: PaymentDto }>) => {
    setRejecting(false);
    acted.current = true;
    await invalidate();
    const rejected = answer.data.payment;
    const byMe = rejected.reviewedBy?.id !== undefined && rejected.reviewedBy.id === me.data?.id;
    if (answer.alreadyApplied && !byMe) {
      setNotice({ tone: 'info', text: handledText(t, rejected.status, rejected.reviewedBy, rejected.reviewedAt) ?? '' });
      void refetch();
      return;
    }
    toast.success(t('reject.done', { distributor }));
    onClose();
  };

  const approveReason = blocked ? t('drawer.bank.mustMatch') : t('drawer.approveDisabled');
  const busy = approve.isPending;

  return (
    <Drawer
      title={t('drawer.title', { distributor, amount: formatRs(payment.amountPaisa) })}
      subtitle={subtitle}
      chip={<StatusChip kind="topup" value={payment.stage} />}
      width="lg"
      dirty={pending && form.isDirty && !acted.current}
      dismissible={!busy}
      onClose={onClose}
      notice={
        notice ? (
          <InlineAlert tone={notice.tone} live>
            {notice.text}
          </InlineAlert>
        ) : undefined
      }
      footer={
        pending
          ? {
              start: (
                <Button variant="ghost-danger" onClick={() => setRejecting(true)} disabled={busy}>
                  {t('drawer.reject')}
                </Button>
              ),
              end: (
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!check.ready || blocked}
                  disabledReason={approveReason}
                  onClick={() => void onApprove()}
                >
                  {t('drawer.approve', { amount: amountText, distributor })}
                </Button>
              ),
            }
          : undefined
      }
    >
      <ToldUs payment={payment} distributor={distributor} onOpenProof={() => setViewingProof(true)} />

      {pending ? (
        <>
          {!rules && rulesError ? (
            <ErrorState compact error={rulesError} onRetry={retryRules} retrying={retryingRules} />
          ) : null}
          <BankDetails form={form} payment={payment} rules={rules} check={check} distributor={distributor} now={now} disabled={busy} />
        </>
      ) : (
        <Decision payment={payment} distributor={distributor} />
      )}

      {pending ? (
        <InlineAlert tone="info" className="sf-topups__rule">
          {t('drawer.rule')}
        </InlineAlert>
      ) : null}

      <RecordActivity resourceType={PAYMENT_RESOURCE} resourceId={payment.id} distributorName={distributor} />

      {rejecting ? (
        <RejectModal
          payment={payment}
          distributor={distributor}
          onClose={() => setRejecting(false)}
          onRejected={(answer) => void onRejected(answer)}
          onHandledElsewhere={(error) => {
            setRejecting(false);
            showServerError(error);
          }}
        />
      ) : null}
      {viewingProof && payment.proofUrl ? (
        <ProofViewer
          url={payment.proofUrl}
          distributor={distributor}
          onClose={() => setViewingProof(false)}
          onRefresh={async () => (await refetch()).data?.proofUrl ?? null}
        />
      ) : null}
    </Drawer>
  );
}

/** Two instants on the same calendar day in Pakistan (UTC+5, no daylight saving). */
function sameKarachiDay(iso: string, now: number): boolean {
  const offset = 5 * 60 * 60 * 1000;
  return new Date(Date.parse(iso) + offset).toISOString().slice(0, 10) === new Date(now + offset).toISOString().slice(0, 10);
}

interface BankCheck {
  /** The reference, amount and time are filled in and valid, and the amount is within the limits. */
  ready: boolean;
  /** The typed bank amount when it is a valid amount. */
  bankAmountPaisa: string | null;
  /** The bank amount differs from the request. */
  mismatch: boolean;
  /** The bank time, when valid. */
  bankTime: string | null;
  timeInFuture: boolean;
  amountOutOfLimits: boolean;
  /** The bank time is more than 24 hours before the request. */
  old: boolean;
}

function checkBankDetails(
  values: { bankReference?: unknown; bankAmountPaisa?: unknown; bankTime?: string },
  payment: PaymentDto,
  rules: TopupRules | null,
  now: number,
): BankCheck {
  const parsed = parseRequest(approveTopupSchema, values);
  const amount = typeof values.bankAmountPaisa === 'string' && /^\d+$/.test(values.bankAmountPaisa) ? values.bankAmountPaisa : null;
  const bankTime = typeof values.bankTime === 'string' && !Number.isNaN(Date.parse(values.bankTime)) ? values.bankTime : null;
  const timeInFuture = bankTime !== null && Date.parse(bankTime) > now + BANK_TIME_MAX_AHEAD_MS;
  const amountNumber = amount === null ? null : Number(amount);
  const amountOutOfLimits =
    amountNumber !== null && rules !== null && (amountNumber < rules.minPaisa || amountNumber > rules.maxPaisa);
  const old = bankTime !== null && Date.parse(payment.createdAt) - Date.parse(bankTime) > DAY_MS;
  return {
    ready: parsed.success && rules !== null && !timeInFuture && !amountOutOfLimits,
    bankAmountPaisa: amount,
    mismatch: amount !== null && BigInt(amount) !== BigInt(payment.amountPaisa),
    bankTime,
    timeInFuture,
    amountOutOfLimits,
    old,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sf-topups__section">
      <h3 className="sf-topups__section-title">{title}</h3>
      {children}
    </section>
  );
}

/** "What Ali Gas told us": the amount, who paid and how, the transaction ID and the screenshot. */
function ToldUs({ payment, distributor, onOpenProof }: { payment: PaymentDto; distributor: string; onOpenProof: () => void }) {
  const { t } = useTranslation('topups');
  const items: KeyValueItem[] = [
    { id: 'amount', label: t('drawer.told.amount'), value: <strong className="sf-topups__amount">{formatRs(payment.amountPaisa)}</strong> },
    { id: 'payer', label: t('drawer.told.paidFrom'), value: payment.payerName?.trim() || t('drawer.told.none') },
    { id: 'channel', label: t('drawer.told.channel'), value: channelWords(payment.payerChannel) ?? t('drawer.told.none') },
    {
      id: 'txn',
      label: t('drawer.told.transactionId'),
      value: payment.transactionId ? (
        <span className="sf-topups__copy-row">
          <span className="sf-topups__mono">{payment.transactionId}</span>
          <CopyButton value={payment.transactionId} label={t('drawer.told.copy')} />
        </span>
      ) : (
        t('drawer.told.none')
      ),
    },
    {
      id: 'proof',
      label: t('drawer.told.screenshot'),
      value: payment.proofUrl ? (
        <button type="button" className="sf-topups__proof-button" onClick={onOpenProof} aria-label={t('drawer.told.openScreenshot')}>
          <img src={payment.proofUrl} alt={t('table.screenshotAlt', { distributor })} className="sf-topups__proof-thumb" />
        </button>
      ) : (
        t('drawer.told.none')
      ),
    },
  ];
  return (
    <Section title={t('drawer.told.title', { distributor })}>
      <KeyValueList items={items} />
    </Section>
  );
}

interface BankDetailsProps {
  form: ReturnType<typeof useZodForm<typeof approveTopupSchema>>;
  payment: PaymentDto;
  rules: TopupRules | null;
  check: BankCheck;
  distributor: string;
  now: number;
  disabled: boolean;
}

/** "Find the payment in the company bank app, then type what it shows": reference, amount and time. */
function BankDetails({ form, payment, rules, check, distributor, now, disabled }: BankDetailsProps) {
  const { t } = useTranslation(['topups', 'errors']);
  const account = rules?.account ?? null;
  const last4 = account ? (account.accountNumber || account.iban).replace(/\s+/g, '').slice(-4) : '';
  const timeError = form.errorFor('bankTime') ?? (check.timeInFuture ? t('errors:TOPUP_BANK_TIME_IN_FUTURE') : undefined);
  const amountError =
    form.errorFor('bankAmountPaisa') ??
    (check.amountOutOfLimits && rules
      ? t('drawer.bank.amountOutOfLimits', { min: formatRs(rules.minPaisa), max: formatRs(rules.maxPaisa) })
      : undefined);

  return (
    <Section title={t('drawer.bank.title')}>
      {rules ? (
        <p className="sf-topups__muted">
          {account
            ? t('drawer.bank.account', { accountTitle: account.accountTitle, bankName: account.bankName, last4 })
            : t('drawer.bank.accountMissing')}
        </p>
      ) : null}
      <form
        className="sf-topups__bank-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Field label={t('drawer.bank.reference')} hint={t('drawer.bank.referenceHint')} error={form.errorFor('bankReference')}>
          <TextInput
            name="bankReference"
            mono
            autoComplete="off"
            spellCheck={false}
            maxLength={REFERENCE_MAX}
            value={typeof form.values.bankReference === 'string' ? form.values.bankReference : ''}
            onChange={(event) => form.setValue('bankReference', event.target.value)}
            onBlur={() => form.touch('bankReference')}
            disabled={disabled}
          />
        </Field>
        <div className="sf-topups__bank-row">
          <Field label={t('drawer.bank.amount')} error={amountError}>
            <MoneyInput
              name="bankAmountPaisa"
              valuePaisa={typeof form.values.bankAmountPaisa === 'string' ? form.values.bankAmountPaisa : null}
              onChange={(value) => form.setValue('bankAmountPaisa', value)}
              onBlur={() => form.touch('bankAmountPaisa')}
              disabled={disabled}
            />
          </Field>
          <Field label={t('drawer.bank.time')} error={timeError}>
            <DateTimeInput
              name="bankTime"
              value={form.values.bankTime ?? null}
              max={new Date(now + BANK_TIME_MAX_AHEAD_MS).toISOString()}
              onChange={(value) => form.setValue('bankTime', value ?? undefined)}
              onBlur={() => form.touch('bankTime')}
              disabled={disabled}
            />
          </Field>
        </div>
      </form>
      {check.mismatch && check.bankAmountPaisa && rules ? (
        rules.onAmountMismatch === 'REJECT' ? (
          <InlineAlert tone="danger" live>
            {t('drawer.bank.mustMatch')}
          </InlineAlert>
        ) : (
          <InlineAlert tone="warning" live>
            {t('drawer.bank.differs', {
              bank: formatRs(check.bankAmountPaisa),
              asked: formatRs(payment.amountPaisa),
              distributor,
            })}
          </InlineAlert>
        )
      ) : null}
      {check.old && check.bankTime ? (
        <InlineAlert tone="warning" live>
          {t('drawer.bank.old', { day: formatDay(check.bankTime) })}
        </InlineAlert>
      ) : null}
    </Section>
  );
}

/** An approved or rejected request: what was decided, by whom and when. */
function Decision({ payment, distributor }: { payment: PaymentDto; distributor: string }) {
  const { t } = useTranslation('topups');
  const by = payment.reviewedBy?.name ?? t('table.none');
  const when = payment.reviewedAt ? formatDateTime(payment.reviewedAt) : t('table.none');
  if (payment.status === 'SUCCESS') {
    const items: KeyValueItem[] = [
      { id: 'credited', label: t('drawer.done.credited'), value: formatRs(payment.creditedPaisa) },
      ...(payment.creditedPaisa !== null && payment.creditedPaisa !== payment.amountPaisa
        ? [{ id: 'asked', label: t('drawer.done.asked'), value: formatRs(payment.amountPaisa) }]
        : []),
      {
        id: 'ref',
        label: t('drawer.done.bankReference'),
        value: payment.bankReference ? <span className="sf-topups__mono">{payment.bankReference}</span> : t('table.none'),
      },
      { id: 'bankAmount', label: t('drawer.done.bankAmount'), value: formatRs(payment.bankAmountPaisa ?? null) },
      {
        id: 'bankTime',
        label: t('drawer.done.bankTime'),
        value: payment.bankReceivedAt ? formatDateTime(payment.bankReceivedAt) : t('table.none'),
      },
      { id: 'by', label: t('drawer.done.by'), value: by },
      { id: 'when', label: t('drawer.done.when'), value: when },
    ];
    return (
      <Section title={t('drawer.done.approvedTitle')}>
        <KeyValueList items={items} />
      </Section>
    );
  }
  const items: KeyValueItem[] = [
    {
      id: 'reason',
      label: t('drawer.done.reason'),
      value: payment.rejectReasonCode ? t(`reject.reasons.${payment.rejectReasonCode}`) : t('table.none'),
    },
    ...(payment.rejectNote ? [{ id: 'note', label: t('drawer.done.note', { distributor }), value: payment.rejectNote }] : []),
    { id: 'by', label: t('drawer.done.by'), value: by },
    { id: 'when', label: t('drawer.done.when'), value: when },
  ];
  return (
    <Section title={t('drawer.done.rejectedTitle')}>
      <KeyValueList items={items} />
    </Section>
  );
}
