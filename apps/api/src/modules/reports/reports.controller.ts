import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { isoDateSchema, isoDateTimeSchema } from '@smartfleet/shared-validation';
import { z } from 'zod';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-body.pipe';
import { pathId } from '../wallet/caller';
import { ReportsService } from './reports.service';

const DAY_MS = 24 * 3600 * 1000;

/** A `since` / `until` bound: an ISO instant or a `YYYY-MM-DD` date (that day's UTC midnight); blank means the default. */
const instantSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .refine((value) => isoDateTimeSchema.safeParse(value).success || isoDateSchema.safeParse(value).success, 'INVALID_DATE')
    .optional(),
);

const sinceQuerySchema = z.object({ since: instantSchema });
const rangeQuerySchema = z.object({ since: instantSchema, until: instantSchema });
type SinceQuery = z.infer<typeof sinceQuerySchema>;
type RangeQuery = z.infer<typeof rangeQuerySchema>;

function since(query: SinceQuery, defaultDays: number): Date {
  return query.since ? new Date(query.since) : new Date(Date.now() - defaultDays * DAY_MS);
}

/**
 * Office reports (API_CONTRACT §7.13). Kept, but hidden on the website: the legacy page is in no menu
 * and opens only at its address. Money figures come from the ledger. SUPER_ADMIN exact.
 */
@Controller('reports')
@ExactRoles(UserRole.SUPER_ADMIN)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('orders-by-zone/:cityId')
  byZone(@Param('cityId') cityId: string, @Query(new ZodQuery(sinceQuerySchema)) query: SinceQuery) {
    return this.reports.ordersByZone(pathId(cityId), since(query, 30));
  }

  @Get('driver-utilization')
  driverUtilization(@Query(new ZodQuery(sinceQuerySchema)) query: SinceQuery) {
    return this.reports.driverUtilization(since(query, 7));
  }

  @Get('driver-attendance')
  driverAttendance(@Query(new ZodQuery(rangeQuerySchema)) query: RangeQuery) {
    return this.reports.driverAttendance(since(query, 7), query.until ? new Date(query.until) : new Date());
  }

  @Get('dispatch-decisions')
  dispatchDecisions(@Query(new ZodQuery(sinceQuerySchema)) query: SinceQuery) {
    return this.reports.dispatchDecisions(since(query, 7));
  }

  @Get('delivery-funnel')
  deliveryFunnel(@Query(new ZodQuery(sinceQuerySchema)) query: SinceQuery) {
    return this.reports.deliveryFunnel(since(query, 30));
  }

  /** Also the expenses page's fuel-log tab (API_CONTRACT §7.12). */
  @Get('fuel-consumption')
  fuelConsumption(@Query(new ZodQuery(sinceQuerySchema)) query: SinceQuery) {
    return this.reports.fuelConsumption(since(query, 30));
  }

  @Get('driver-performance')
  driverPerformance(@Query(new ZodQuery(sinceQuerySchema)) query: SinceQuery) {
    return this.reports.driverPerformance(since(query, 30));
  }
}
