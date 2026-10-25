import { AlertSeverity, AlertStatus, AlertType, type Prisma } from '@prisma/client';
import type { VanNotEmptyContext } from '@smartfleet/shared-types';
import type { AlertsService } from '../alerts/alerts.service';
import type { Tx } from '../orders/support/tx';

/** VAN_NOT_EMPTY alerts point at the van. */
export const VAN_ALERT_RESOURCE_TYPE = 'Vehicle';

/**
 * Raises VAN_NOT_EMPTY (WARNING) for a van still holding cylinders, or refreshes the one already
 * unresolved (API_CONTRACT §9.9): one OPEN or ACKNOWLEDGED alert per van, whose title, body and context a
 * new raise replaces (so the office reads the count the van has now), keeping its status. It stays until
 * the office resolves it. Runs in the caller's transaction (a finish with leftovers, or the 03:00 job). No
 * money.
 */
export async function raiseVanNotEmpty(alerts: AlertsService, tx: Tx, context: VanNotEmptyContext): Promise<void> {
  // Two raises for one van at once (the job and a late finish) must still leave one alert.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`van-not-empty:${context.vehicleId}`}))`;
  const json = context as unknown as Prisma.InputJsonValue;
  const reason = context.leftoverReason ? ` Reason: ${context.leftoverReason}` : '';
  await alerts.raise(
    {
      alertType: AlertType.VAN_NOT_EMPTY,
      severity: AlertSeverity.WARNING,
      title: `${context.plateNo} still has cylinders on it (${context.count})`,
      body: `${context.plateNo} still has ${context.count} cylinder(s) on it. The shop must scan them in.${reason}`,
      resourceType: VAN_ALERT_RESOURCE_TYPE,
      resourceId: context.vehicleId,
      context: json,
      dedupeKey: { alertType: AlertType.VAN_NOT_EMPTY, resourceType: VAN_ALERT_RESOURCE_TYPE, resourceId: context.vehicleId },
      // One OPEN or ACKNOWLEDGED alert per van: an acknowledged one keeps its status and gets the new count, words and reason.
      dedupeStatuses: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED],
    },
    tx,
  );
}
