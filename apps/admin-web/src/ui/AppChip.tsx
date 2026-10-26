import type { AppSeenDto } from '@smartfleet/shared-types';
import { formatDateTime } from '../i18n/format';
import { appChipStatus } from './appChipStatus';
import { StatusChip } from './StatusChip';

export interface AppChipProps {
  /** `DistributorDto.app` or `DriverOfficeDto.app`. */
  app: AppSeenDto | undefined;
  /** The account can sign in: a suspended or archived one shows no chip. */
  active: boolean;
  className?: string;
}

/**
 * The app a distributor or driver last used (API_CONTRACT §8.5 step 10, UX_ADMIN §2.4, §2.11): "App: up to date"
 * (green), "App: needs update" (amber, an older version than `app.minVersion`) or "App: not opened yet" (grey).
 * The version and the time of that call show on hover. Nothing for a signed-out account or an older server.
 */
export function AppChip({ app, active, className }: AppChipProps) {
  const status = appChipStatus(app, active);
  if (!status || !app) return null;
  const title = app.version && app.seenAt ? `${app.version} · ${formatDateTime(app.seenAt)}` : undefined;
  return (
    <span title={title} className={className}>
      <StatusChip kind="app" value={status} />
    </span>
  );
}
