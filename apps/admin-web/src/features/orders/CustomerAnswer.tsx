import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import type { ConfirmationView, OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { toApiError } from '../../api/errors';
import { useAppConfig } from '../../hooks/useAppConfig';
import i18n from '../../i18n';
import { Button, ErrorState, SkeletonText, useToast } from '../../ui';
import { AnswerChip, answerValue } from '../problems/answer';
import { useCopyCustomerLink, useInvalidateOrder, useOrderConfirmation } from './api';
import { whenText } from './format';

/** A failed send's reason in words (CUSTOMER_PAGE §8); an unknown code reads "something went wrong". */
function failReason(code: string | null | undefined): string {
  switch (code) {
    case 'INVALID_NUMBER':
    case 'REJECTED':
    case 'TIMEOUT':
    case 'AUTH':
    case 'UNAVAILABLE':
      return i18n.t(`orders:answer.failReason.${code}`);
    default:
      return i18n.t('orders:answer.failReason.UNKNOWN');
  }
}

/**
 * The one link-status line (CUSTOMER_PAGE §8, UX_ADMIN §3.2), from `reach` and `lastMessage`: "Not sent",
 * "Not sent · text messages are off", "Sending text…", "Text sent 10:58 am", "Text didn't send · the number
 * looks wrong", "Shared 11:00 am by Ops (copied)"; once closed, "Answered 11:20 am" or "Expired".
 */
export function linkStatus(view: ConfirmationView, now: number = Date.now()): string | null {
  const t = i18n.t;
  if (view.status === 'ANSWERED') {
    return view.respondedAt ? t('orders:answer.link.answered', { time: whenText(view.respondedAt, now) }) : null;
  }
  if (view.status === 'EXPIRED') return t('orders:answer.link.expired');
  if (view.status === 'CANCELLED') return null;
  const last = view.lastMessage;
  switch (view.reach) {
    case 'SMS_SENDING':
      return t('orders:answer.link.sending');
    case 'SMS_SENT':
      return last ? t('orders:answer.link.sent', { time: whenText(last.at, now) }) : t('orders:answer.link.notSent');
    case 'SMS_FAILED':
      return t('orders:answer.link.failed', { reason: failReason(last?.errorCode) });
    case 'SHARED': {
      if (!last) return t('orders:answer.link.notSent');
      const via = last.via ? t(`orders:answer.via.${last.via}`) : t('orders:answer.via.COPY');
      const time = whenText(last.at, now);
      return last.byName ? t('orders:answer.link.shared', { time, name: last.byName, via }) : t('orders:answer.link.sharedNoName', { time, via });
    }
    default:
      // No message, a lost send, or an SMS that test mode or the mock provider skipped.
      return last?.channel === 'SMS' && last.status === 'SKIPPED' ? t('orders:answer.link.smsOff') : t('orders:answer.link.notSent');
  }
}

/** The confirmation view of a delivered order, while confirmations are on; `enabled` false otherwise. */
export function useAnswerOf(order: OrderDto) {
  const { config } = useAppConfig();
  const enabled = config.features.confirmations && order.stage === 'DELIVERED' && Boolean(order.confirmation);
  const query = useOrderConfirmation(order.id, enabled);
  return { enabled, query };
}

/** The refusals that mean "nothing to show here": switched off, not delivered, no confirmation row. */
function hidesSection(error: unknown): boolean {
  return toApiError(error).is('FEATURE_DISABLED', 'CONFIRM_NOT_READY', 'NOT_FOUND');
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sf-order__section" aria-label={title}>
      <h3 className="sf-order__section-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * "Copy customer link" (UX_ADMIN §3.2): it asks the server for the link (`share { via: 'COPY' }`, which
 * the status line then shows as "Shared … (copied)") and puts it on the clipboard: toast "Link copied".
 * When the browser blocks the clipboard, the link shows in a box to select and copy by hand.
 */
function CopyLinkButton({ order }: { order: OrderDto }) {
  const { t } = useTranslation(['orders', 'common']);
  const toast = useToast();
  const share = useCopyCustomerLink(order.id);
  const invalidate = useInvalidateOrder(order.id);
  const [manual, setManual] = useState<string | null>(null);
  const boxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (manual) boxRef.current?.select();
  }, [manual]);

  const copy = () => {
    if (share.isPending) return;
    share.mutate(undefined, {
      onSuccess: async (result) => {
        void invalidate();
        try {
          if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
          await navigator.clipboard.writeText(result.url);
          setManual(null);
          toast.success(t('answer.copied'));
        } catch {
          setManual(result.url);
        }
      },
      onError: (failure) => {
        toast.error(failure);
        if (failure.is('CONFIRM_CLOSED')) void invalidate();
      },
    });
  };

  return (
    <div className="sf-order__answer-copy">
      <Button icon={Copy} loading={share.isPending} onClick={copy}>
        {t('answer.copy')}
      </Button>
      {manual ? (
        <span className="sf-copy-manual">
          <input ref={boxRef} className="sf-input sf-input--mono" readOnly value={manual} aria-label={t('answer.linkLabel')} />
          <span className="sf-copy-manual__hint">{t('common:copy.failed')}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * The "Customer answer" section of the order drawer (Inc 2, UX_ADMIN §3.2), after Cylinders, only while
 * customer confirmation is on and the order has one: the answer chip, the comment in quotes, one
 * link-status line and, while the link is open, "Copy customer link", here and never in the footer (the
 * footer keeps 4 buttons at most). The answer never changes money.
 */
export function CustomerAnswerSection({ order, answer }: { order: OrderDto; answer: ReturnType<typeof useAnswerOf> }) {
  const { t } = useTranslation('orders');
  const { enabled, query } = answer;
  if (!enabled) return null;
  if (query.isError && !query.data && hidesSection(query.error)) return null;

  let body: ReactNode;
  if (query.isPending) {
    body = <SkeletonText lines={2} />;
  } else if (!query.data) {
    body = (
      <ErrorState compact error={query.error} title={t('answer.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
    );
  } else {
    const view = query.data;
    const value = answerValue(view);
    const status = linkStatus(view);
    body = (
      <>
        {value ? (
          <p className="sf-order__line">
            <AnswerChip value={value} />
          </p>
        ) : null}
        {view.comment ? <p className="sf-order__quote">{t('answer.comment', { comment: view.comment })}</p> : null}
        {status ? <p className="sf-orders__muted">{status}</p> : null}
        {view.allowedActions.includes('SHARE') ? <CopyLinkButton order={order} /> : null}
      </>
    );
  }
  return <Section title={t('answer.title')}>{body}</Section>;
}
