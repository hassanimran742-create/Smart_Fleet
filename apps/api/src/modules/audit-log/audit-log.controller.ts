import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuditLogDto, Page } from '@smartfleet/shared-types';
import { businessDayRange } from '@smartfleet/shared-utils';
import {
  isoDateSchema,
  isoDateTimeSchema,
  optionalTextSchema,
  optionalUuidSchema,
  pageQuerySchema,
} from '@smartfleet/shared-validation';
import { z } from 'zod';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-body.pipe';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from './audit-log.service';

const dateOrInstant = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.union([isoDateSchema, isoDateTimeSchema]).optional(),
);

/** `GET /audit-logs?resourceType&resourceId&action&actorUserId&distributorId&from&to&cursor&limit`. */
export const auditLogsQuerySchema = pageQuerySchema.extend({
  resourceType: optionalTextSchema(64),
  resourceId: optionalUuidSchema,
  action: optionalTextSchema(64),
  actorUserId: optionalUuidSchema,
  distributorId: optionalUuidSchema,
  /** A business date (from its 03:00 start) or an instant. */
  from: dateOrInstant,
  /** A business date (to its end) or an instant (exclusive). */
  to: dateOrInstant,
});
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Controller('audit-logs')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AuditLogController {
  constructor(
    private readonly logs: AuditLogService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async list(@Query(new ZodQuery(auditLogsQuerySchema)) query: AuditLogsQuery): Promise<Page<AuditLogDto>> {
    const day = {
      timezone: await this.settings.get('day.timezone'),
      cutoffLocalTime: await this.settings.get('day.cutoffLocalTime'),
    };
    const instant = (value: string | undefined, edge: 'start' | 'end'): Date | undefined => {
      if (!value) return undefined;
      if (DATE_ONLY.test(value)) return businessDayRange(value, day)[edge];
      return new Date(value);
    };
    return this.logs.list({
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      action: query.action,
      actorUserId: query.actorUserId,
      distributorId: query.distributorId,
      from: instant(query.from, 'start'),
      to: instant(query.to, 'end'),
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
