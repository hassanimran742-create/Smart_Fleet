import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import type { PaymentDto, TopupApproveResult } from '@smartfleet/shared-types';
import { approveTopupSchema, BANK_TIME_MAX_AHEAD_MS, isValidBankReference, parseRequest } from '@smartfleet/shared-validation';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { errorDetails, messageFor, toApiError, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { ButtonLink } from '../../app/ButtonLink';
import { useCloseDrawer } from '../../app/drawer';
import { useMe } from '../../hooks/useMe';
import { useNow } from '../../hooks/useNow';
import { formatDateTime, formatDay, formatRs, formatTime, formatWait } from '../../i18n/format';
import {
  ActivityList,
  Button,
  CopyButton,
  DateTimeInput,
  Drawer,
  ErrorState,
  Field,
  flashRow,
  InlineAlert,
  KeyValueList,
  MoneyInput,
  Skeleton,
  SkeletonText,
  StatusChip,
  TextInput,
  useConfirm,
  useToast,
  useZodForm,
  type DateTimeParts,
  type DrawerFooter,
  type KeyValueItem,
} from '../../ui';
import {
  TOPUPS_FLASH,
  type ActionAnswer,
  type TopupRules,
  useApproveTopup,
  useCachedTopup,
  useInvalidateAfterTopup,
  useTopup,
  useTopupRules,
} from './api';
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

/** "Ahmed Gas · Rs 3,000", the drawer's title in every state (website spec W07, W10). */
function titleOf(t: TFunction<'topups'>, payment: Pick<PaymentDto, 'distributor' | 'amountPaisa'>): string {
  return t('drawer.title', { distributor: payment.distributor?.businessName ?? '', amount: formatRs(payment.amountPaisa) });
}

/**
 * The top-up drawer (`/topups/$paymentId`, website spec W07–W10): a request to check, or the decision on
 * one. It re-polls every 10 seconds: when another office user approves or rejects the request
 * meanwhile, it says so and locks.
 */
export function TopupDrawer() {
  const { t } = useTranslation(['topups', 'nav']);
  const { paymentId } = route.useParams();
  const close = useCloseDrawer();
  const query = useTopup(paymentId);
  // The list's row, so the title shows at once while the request loads.
  const known = useCachedTopup(paymentId);

  if (query.isPending) {
    return (
      <Drawer title={known ? titleOf(t, known) : <Skeleton width="16rem" />} width="lg" onClose={close}>
        <div className="sf-topups__columns" aria-hidden>
          <SkeletonText lines={6} />
          <SkeletonText lines={9} />
        </div>
      </Drawer>
    );
  }
  if (!query.data) {
    return (
      <Drawer title={known ? titleOf(t, known) : t('nav:pages.topup')} width="lg" onClose={close}>
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
  t: TFunction<'topups'>,
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

/** Where the focus goes when the main button is pressed with something missing, in the form's order. */
type BankField = 'reference' | 'amount' | 'date' | 'time';

const FOCUS_TARGET: Record<BankField, string> = {
  reference: '[name="bankReference"]',
  amount: '[name="bankAmountPaisa"]',
  // The picked chip, else the first one (FilterChips keeps exactly one chip in the tab order).
  date: '.sf-datetime [role="radio"][tabindex="0"]',
  time: '[name="bankTime"]',
};

function TopupReview({ payment, onClose, refetch }: ReviewProps) {
  const { t } = useTranslation(['topups', 'errors']);
  const toast = useToast();
  const confirm = useConfirm();
  const me = useMe();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAfterTopup();
  const { rules, error: rulesError, retry: retryRules, retrying: retryingRules } = useTopupRules();
  const approve = useApproveTopup(payment.id);
  const now = useNow(30_000);
  const form = useZodForm(approveTopupSchema, { bankReference: '', bankAmountPaisa: null, bankTime: undefined });
  const [parts, setParts] = useState<DateTimeParts>({ date: '', time: '' });
  const [amountText, setAmountText] = useState('');
  const [pressed, setPressed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [viewingProof, setViewingProof] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
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
  const amountForButton = formatRs(check.bankAmountPaisa ?? payment.amountPaisa);
  // The one thing nothing on this screen can fix: the settings refuse a different amount.
  const blocked = check.mismatch && rules?.onAmountMismatch === 'REJECT';

  // Each field's one line: what is missing (after a press), else what is wrong with it.
  // `errorFor` holds only the server's answers here: the form never calls touch or handleSubmit, so a box
  // left empty says nothing until the main button is pressed (website spec §1.7).
  const reference = typeof form.values.bankReference === 'string' ? form.values.bankReference : '';
  const referenceError =
    form.errorFor('bankReference') ?? (pressed && !isValidBankReference(reference.trim()) ? t('errors:TOPUP_BANK_REFERENCE_REQUIRED') : undefined);
  const amountMissing = pressed && check.bankAmountPaisa === null && amountText.trim() === '';
  const amountError = amountMissing
    ? t('drawer.bank.amountMissing')
    : (form.errorFor('bankAmountPaisa') ??
      (check.amountOutOfLimits && rules
        ? t('drawer.bank.amountOutOfLimits', { min: formatRs(rules.minPaisa), max: formatRs(rules.maxPaisa) })
        : undefined));
  const dateError = pressed && !parts.date ? t('drawer.bank.dateMissing') : null;
  const timeError =
    pressed && !parts.time
      ? t('drawer.bank.timeMissing')
      : check.timeInFuture
        ? t('errors:TOPUP_BANK_TIME_IN_FUTURE')
        : (form.errorFor('bankTime') ?? null);

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
        amount: formatRs(approved.creditedPaisa ?? check.bankAmountPaisa ?? payment.amountPaisa),
        distributor,
        balance: formatRs(wallet.balancePaisa),
      }),
    );
    flashRow(TOPUPS_FLASH, payment.id);
    onClose();
  };

  /** The first field that still needs something, in the order the form shows them. */
  const firstGap = (): BankField | null => {
    if (!isValidBankReference(reference.trim())) return 'reference';
    if (check.bankAmountPaisa === null || check.amountOutOfLimits) return 'amount';
    if (!parts.date) return 'date';
    if (!parts.time || check.timeInFuture || check.bankTime === null) return 'time';
    return null;
  };

  // The main button stays pressable (website spec §1.7): pressed with a gap, each missing field says
  // what to do and the first one gets the focus; with everything filled it asks to confirm (W08).
  const onApprove = async () => {
    setPressed(true);
    const gap = firstGap();
    if (gap) {
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(FOCUS_TARGET[gap])?.focus());
      return;
    }
    const parsed = parseRequest(approveTopupSchema, form.values);
    if (!parsed.success || blocked) return;
    const body = { bankReference: parsed.data.bankReference, bankAmountPaisa: parsed.data.bankAmountPaisa, bankTime: parsed.data.bankTime };
    const amount = formatRs(body.bankAmountPaisa);
    const facts: KeyValueItem[] = [
      { id: 'reference', label: t('confirm.reference'), value: <span className="sf-topups__mono">{body.bankReference}</span> },
      { id: 'amount', label: t('confirm.bankAmount'), value: amount },
      { id: 'time', label: t('confirm.bankTime'), value: formatDateTime(body.bankTime) },
    ];
    if (check.mismatch) {
      facts.push({
        id: 'asked',
        label: t('confirm.asked'),
        value: (
          <>
            <strong>{formatRs(payment.amountPaisa)}</strong>{' '}
            <span className="sf-topups__muted">
              <span aria-hidden>· </span>
              {t('confirm.different')}
            </span>
          </>
        ),
      });
    }
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
    flashRow(TOPUPS_FLASH, payment.id);
    onClose();
  };

  const busy = approve.isPending;
  const typedAnything = form.isDirty || parts.date !== '' || parts.time !== '' || amountText.trim() !== '';

  let footer: DrawerFooter | undefined;
  if (pending) {
    footer = {
      start: (
        <Button variant="ghost-danger" onClick={() => setRejecting(true)} disabled={busy}>
          {t('drawer.reject')}
        </Button>
      ),
      end: (
        <Button
          variant="primary"
          loading={busy}
          disabled={blocked}
          disabledReason={blocked ? t('drawer.bank.mustMatchShort') : undefined}
          reasonVisible
          onClick={() => void onApprove()}
        >
          {t('drawer.approve', { amount: amountForButton, distributor })}
        </Button>
      ),
    };
  } else if (payment.status === 'SUCCESS' && payment.distributor) {
    footer = {
      end: (
        <ButtonLink to="/wallets/$distributorId" params={{ distributorId: payment.distributor.id }} search={{}}>
          {t('drawer.openWallet')}
        </ButtonLink>
      ),
    };
  }

  return (
    <Drawer
      title={titleOf(t, payment)}
      subtitle={subtitle}
      chip={<StatusChip kind="topup" value={payment.stage} />}
      width="lg"
      dirty={pending && typedAnything && !acted.current}
      dismissible={!busy}
      onClose={onClose}
      notice={
        notice ? (
          <InlineAlert tone={notice.tone} live>
            {notice.text}
          </InlineAlert>
        ) : undefined
      }
      footer={footer}
    >
      <div className="sf-topups__columns">
        <SentDetails payment={payment} distributor={distributor} onOpenProof={() => setViewingProof(true)} />
        {pending ? (
          <section className="sf-topups__section" aria-labelledby={`sf-topup-bank-${payment.id}`}>
            <h3 id={`sf-topup-bank-${payment.id}`} className="sf-topups__section-title">
              {t('drawer.bank.title')}
            </h3>
            <p className="sf-topups__never">{t('drawer.bank.never')}</p>
            {rules ? <AccountLine rules={rules} /> : null}
            {!rules && rulesError ? (
              <ErrorState compact error={rulesError} onRetry={retryRules} retrying={retryingRules} />
            ) : null}
            <div ref={formRef} className="sf-topups__bank-form">
              <Field label={t('drawer.bank.reference')} hint={t('drawer.bank.referenceHint')} error={referenceError}>
                <TextInput
                  name="bankReference"
                  mono
                  data-autofocus
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={REFERENCE_MAX}
                  value={reference}
                  onChange={(event) => form.setValue('bankReference', event.target.value)}
                  disabled={busy}
                />
              </Field>
              <Field label={t('drawer.bank.amount')} error={amountError}>
                <MoneyInput
                  name="bankAmountPaisa"
                  valuePaisa={typeof form.values.bankAmountPaisa === 'string' ? form.values.bankAmountPaisa : null}
                  onChange={(value) => form.setValue('bankAmountPaisa', value)}
                  onInput={(event) => setAmountText(event.currentTarget.value)}
                  disabled={busy}
                />
              </Field>
              <DateTimeInput
                name="bankTime"
                value={form.values.bankTime ?? null}
                max={new Date(now + BANK_TIME_MAX_AHEAD_MS).toISOString()}
                dateLabel={t('drawer.bank.date')}
                timeLabel={t('drawer.bank.time')}
                dateError={dateError}
                timeError={timeError}
                onPartsChange={setParts}
                onChange={(iso) => form.setValue('bankTime', iso ?? undefined)}
                disabled={busy}
              />
            </div>
          </section>
        ) : (
          <Decision payment={payment} distributor={distributor} />
        )}
      </div>

      {pending ? <CheckLine payment={payment} rules={rules} check={check} /> : null}

      <ActivityList resourceType={PAYMENT_RESOURCE} resourceId={payment.id} />

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
  /** The typed bank amount when it is a valid amount. */
  bankAmountPaisa: string | null;
  /** The bank amount differs from the request. */
  mismatch: boolean;
  /** The bank time, when both its date and time are picked. */
  bankTime: string | null;
  timeInFuture: boolean;
  amountOutOfLimits: boolean;
  /** The bank time is more than 24 hours before the request. */
  old: boolean;
}

function checkBankDetails(
  values: { bankAmountPaisa?: unknown; bankTime?: string },
  payment: PaymentDto,
  rules: TopupRules | null,
  now: number,
): BankCheck {
  const amount = typeof values.bankAmountPaisa === 'string' && /^\d+$/.test(values.bankAmountPaisa) ? values.bankAmountPaisa : null;
  const bankTime = typeof values.bankTime === 'string' && !Number.isNaN(Date.parse(values.bankTime)) ? values.bankTime : null;
  const timeInFuture = bankTime !== null && Date.parse(bankTime) > now + BANK_TIME_MAX_AHEAD_MS;
  const amountNumber = amount === null ? null : Number(amount);
  const amountOutOfLimits =
    amountNumber !== null && rules !== null && (amountNumber < rules.minPaisa || amountNumber > rules.maxPaisa);
  const old = bankTime !== null && Date.parse(payment.createdAt) - Date.parse(bankTime) > DAY_MS;
  return {
    bankAmountPaisa: amount,
    mismatch: amount !== null && BigInt(amount) !== BigInt(payment.amountPaisa),
    bankTime,
    timeInFuture,
    amountOutOfLimits,
    old,
  };
}

/** "Smart Fleet (Pvt) Ltd · Test Bank · ending 0000", or that the account isn't set. */
function AccountLine({ rules }: { rules: TopupRules }) {
  const { t } = useTranslation('topups');
  const account = rules.account;
  if (!account) return <p className="sf-topups__account">{t('drawer.bank.accountMissing')}</p>;
  const last4 = (account.accountNumber || account.iban).replace(/\s+/g, '').slice(-4);
  return (
    <p className="sf-topups__account">
      {t('drawer.bank.account', { accountTitle: account.accountTitle, bankName: account.bankName, last4 })}
    </p>
  );
}

/**
 * Under both columns, once the bank amount is typed: "Amounts match", or the one warning that applies
 * (a different amount, as the settings handle it; a bank date over a day before the request).
 */
function CheckLine({ payment, rules, check }: { payment: PaymentDto; rules: TopupRules | null; check: BankCheck }) {
  const { t } = useTranslation('topups');
  const lines: ReactNode[] = [];
  if (check.bankAmountPaisa !== null && !check.amountOutOfLimits) {
    if (!check.mismatch) {
      lines.push(
        <p key="match" className="sf-topups__match" role="status">
          <CircleCheck aria-hidden size={18} strokeWidth={2} />
          <span>{t('drawer.bank.match')}</span>
        </p>,
      );
    } else if (rules?.onAmountMismatch === 'REJECT') {
      lines.push(
        <InlineAlert key="mismatch" tone="danger" live>
          {t('drawer.bank.mustMatch')}
        </InlineAlert>,
      );
    } else if (rules) {
      lines.push(
        <InlineAlert key="mismatch" tone="warning" live>
          {t('drawer.bank.differs', { bank: formatRs(check.bankAmountPaisa), asked: formatRs(payment.amountPaisa) })}
        </InlineAlert>,
      );
    }
  }
  if (check.old && check.bankTime) {
    lines.push(
      <InlineAlert key="old" tone="warning" live>
        {t('drawer.bank.old', { day: formatDay(check.bankTime) })}
      </InlineAlert>,
    );
  }
  return lines.length > 0 ? <div className="sf-topups__check">{lines}</div> : null;
}

/** "From Ahmed Gas": the amount, who paid and how, the transaction ID and the screenshot. */
function SentDetails({ payment, distributor, onOpenProof }: { payment: PaymentDto; distributor: string; onOpenProof: () => void }) {
  const { t } = useTranslation('topups');
  const none = t('drawer.told.none');
  const items: KeyValueItem[] = [
    { id: 'amount', label: t('drawer.told.amount'), value: <span className="sf-topups__amount">{formatRs(payment.amountPaisa)}</span> },
    { id: 'payer', label: t('drawer.told.paidFrom'), value: payment.payerName?.trim() || none },
    { id: 'channel', label: t('drawer.told.channel'), value: channelWords(payment.payerChannel) ?? none },
    {
      id: 'txn',
      label: t('drawer.told.transactionId'),
      value: payment.transactionId ? (
        <span className="sf-topups__copy-row">
          <span className="sf-topups__mono">{payment.transactionId}</span>
          <CopyButton iconOnly value={payment.transactionId} label={t('drawer.told.copy')} />
        </span>
      ) : (
        none
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
        none
      ),
    },
  ];
  return (
    <section className="sf-topups__section" aria-labelledby={`sf-topup-sent-${payment.id}`}>
      <h3 id={`sf-topup-sent-${payment.id}`} className="sf-topups__section-title">
        {t('drawer.told.title', { distributor })}
      </h3>
      <KeyValueList stacked items={items} />
    </section>
  );
}

/** A decided request (W10): what was added or why it was refused, and who decided when. */
function Decision({ payment, distributor }: { payment: PaymentDto; distributor: string }) {
  const { t } = useTranslation('topups');
  const none = t('table.none');
  const when = payment.reviewedAt ? formatDateTime(payment.reviewedAt) : none;
  const byWhen = payment.reviewedBy?.name ? t('drawer.done.byWhen', { name: payment.reviewedBy.name, when }) : when;
  const items: KeyValueItem[] =
    payment.status === 'SUCCESS'
      ? [
          { id: 'credited', label: t('drawer.done.credited'), value: <strong>{formatRs(payment.creditedPaisa)}</strong> },
          ...(payment.creditedPaisa !== null && payment.creditedPaisa !== payment.amountPaisa
            ? [{ id: 'asked', label: t('drawer.done.asked'), value: formatRs(payment.amountPaisa) }]
            : []),
          {
            id: 'ref',
            label: t('drawer.done.bankReference'),
            value: payment.bankReference ? <span className="sf-topups__mono">{payment.bankReference}</span> : none,
          },
          {
            id: 'bankTime',
            label: t('drawer.done.bankTime'),
            value: payment.bankReceivedAt ? formatDateTime(payment.bankReceivedAt) : none,
          },
          { id: 'by', label: t('drawer.done.approvedBy'), value: byWhen },
        ]
      : [
          {
            id: 'reason',
            label: t('drawer.done.reason'),
            value: payment.rejectReasonCode ? t(`reject.reasons.${payment.rejectReasonCode}`) : none,
          },
          ...(payment.rejectNote ? [{ id: 'note', label: t('drawer.done.note', { distributor }), value: payment.rejectNote }] : []),
          { id: 'by', label: t('drawer.done.rejectedBy'), value: byWhen },
        ];
  return (
    <section className="sf-topups__section sf-topups__decision">
      <KeyValueList stacked items={items} />
    </section>
  );
}
