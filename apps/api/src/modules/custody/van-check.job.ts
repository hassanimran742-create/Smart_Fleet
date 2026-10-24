import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CustodyType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { LOCKING_TX } from '../orders/support/tx';
import { openRefillLineCylinderIds } from './custody-moves';
import { countCylindersOnVehicle } from './van';
import { raiseVanNotEmpty } from './van-alerts';

/** The job's name in the scheduler registry (API_CONTRACT §9.9). */
export const VAN_CHECK_JOB = 'day-cutoff-van-check';

/** One run's result. */
export interface VanCheckRun {
  /** Vans holding at least one cylinder. */
  vans: number;
  /** Their plates, in order. */
  plates: string[];
}

/**
 * The day cut-off van check (API_CONTRACT §9.9), at 03:00 Pakistan time: every van holding at least
 * one cylinder (Inc 3: not counting cylinders on an open refill line), whatever its trips, raises
 * VAN_NOT_EMPTY (WARNING), or refreshes the van's unresolved one (one OPEN or ACKNOWLEDGED alert per
 * van). It never resolves an alert, never moves a cylinder and moves no money.
 */
@Injectable()
export class VanCheckJob {
  private readonly logger = new Logger(VanCheckJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron('0 3 * * *', { name: 'day-cutoff-van-check', timeZone: 'Asia/Karachi' })
  async nightly(): Promise<void> {
    try {
      const run = await this.run();
      if (run.vans > 0) this.logger.warn(`Van check: ${run.vans} van(s) still hold cylinders: ${run.plates.join(', ')}`);
    } catch (error) {
      this.logger.error(`Van check failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  /** One run of the check; the scheduled handler calls it, and tests may call it directly. */
  async run(): Promise<VanCheckRun> {
    const loaded = await this.prisma.cylinder.groupBy({ by: ['custodyId'], where: { custodyType: CustodyType.VEHICLE } });
    const plates: string[] = [];
    for (const { custodyId: vehicleId } of loaded) {
      const plate = await this.prisma.$transaction(async (tx) => {
        // [Inc 3] Cylinders on an open refill line are the refill's, not leftovers (§9.9).
        const onRefill = await openRefillLineCylinderIds(tx, { vehicleId });
        const count = (await countCylindersOnVehicle(tx, vehicleId)) - onRefill.size;
        if (count <= 0) return null;
        const van = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { plateNo: true } });
        const lastTrip = await tx.trip.findFirst({
          where: { vehicleId },
          orderBy: [{ plannedAt: 'desc' }, { id: 'desc' }],
          select: { id: true, leftoverReason: true },
        });
        await raiseVanNotEmpty(this.alerts, tx, {
          vehicleId,
          plateNo: van?.plateNo ?? '',
          count,
          tripId: lastTrip?.id ?? null,
          leftoverReason: lastTrip?.leftoverReason ?? null,
        });
        return van?.plateNo ?? vehicleId;
      }, LOCKING_TX);
      if (plate) plates.push(plate);
    }
    plates.sort();
    return { vans: plates.length, plates };
  }
}
