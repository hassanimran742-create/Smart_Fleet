import type { ConfirmationResponse, ConfirmationStatus } from '@smartfleet/shared-types';
import { StatusChip } from '../../ui';

/** What the customer's answer chip can say: an answer, or where the link stands. */
export type AnswerValue = ConfirmationResponse | 'PENDING' | 'EXPIRED' | 'CANCELLED';

/**
 * The chip value of a confirmation (`OrderDto.confirmation`, a `ConfirmationView`): the answer once
 * answered, else the link's status; null when there is nothing to show.
 */
export function answerValue(
  confirmation: { status: ConfirmationStatus; response: ConfirmationResponse | null } | null | undefined,
): AnswerValue | null {
  if (!confirmation) return null;
  if (confirmation.status === 'ANSWERED') return confirmation.response ?? null;
  if (confirmation.status === 'PENDING' || confirmation.status === 'EXPIRED' || confirmation.status === 'CANCELLED') {
    return confirmation.status;
  }
  return null;
}

/**
 * The customer's answer as its own chip (rulebook §4.1: never the order's status): "Customer: not
 * received", "Waiting for customer". The kit's `answer` kind carries the tones of settled point G07-23
 * (kept by the lead on 2026-10-23): all received green; partly received and a note amber with the
 * warning icon (not the clock, which means waiting); not received red; waiting the amber clock; no
 * answer grey.
 */
export function AnswerChip({ value, className }: { value: AnswerValue; className?: string }) {
  return <StatusChip kind="answer" value={value} className={className} />;
}
