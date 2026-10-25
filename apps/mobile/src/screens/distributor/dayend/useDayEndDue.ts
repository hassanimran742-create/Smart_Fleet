import { useQuery } from '@tanstack/react-query';
import type { DayEndListItem, Page } from '@smartfleet/shared-types';
import { businessDate } from '@smartfleet/shared-utils';
import type { ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { useAppConfig } from '../../../hooks/useAppConfig';
import { fetchDayEndList } from '../shared/api';
import { dayEndTarget, type DayEndTarget } from './dayEndModel';

export interface DayEndDue {
  /** Today's business date (the cut-off as the phone reads it, `appConfig.day`). */
  today: string;
  /** The day Home's row names and S19 opens on: today until the list answers, or when it can't. */
  target: DayEndTarget;
  /** The list has answered (or failed, or day-end is off), so `target` is final for now. */
  settled: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * [Inc 3] The day that waits for the shop (review23 ux-01): reads `GET /day-end` (one page, newest
 * first) and picks a day the office sent back or reopened, else an earlier day never sent, else today
 * (dayEndModel.dayEndTarget). Shared by Home's "Day-end sheet" row and S19, so both name the same day.
 */
export function useDayEndDue(now: number): DayEndDue {
  const { config } = useAppConfig();
  const enabled = config.features.dayEnd;
  const list = useQuery<Page<DayEndListItem>, ApiError>({
    queryKey: qk.dayEndList,
    queryFn: fetchDayEndList,
    enabled,
  });
  const today = businessDate(now, config.day);
  return {
    today,
    target: dayEndTarget(list.data?.items ?? [], today),
    settled: !enabled || list.data !== undefined || list.isError,
    refetch: list.refetch,
  };
}
