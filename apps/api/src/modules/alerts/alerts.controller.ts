import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  alertsQuerySchema,
  casesQuerySchema,
  myCasesQuerySchema,
  parseRequest,
  resolveCaseSchema,
  type ResolveCaseInput,
} from '@smartfleet/shared-validation';
import type { z } from 'zod';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { toFieldErrors, ZodBody } from '../../common/pipes/zod-body.pipe';
import { AlertRulesService } from './alert-rules.service';
import { AlertsService, CASE_ALERT_TYPE } from './alerts.service';
import { CasesService } from './cases.service';

/** A query parsed with a shared schema, refused like `ZodQuery` refuses it. */
function parsedQuery<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const result = parseRequest(schema, raw);
  if (result.success) return result.data;
  throw new AppError(result.errorCode, { fields: toFieldErrors(result.fields) });
}

/**
 * The office alerts (API_CONTRACT §7.2: office exact) and, from Inc 2, the customer-problem cases
 * (§9.6). The legacy list, count, acknowledge and resolve never show or touch a case; a case is listed
 * with `?type=CUSTOMER_PROBLEM` and closes only through `POST /alerts/:id/resolve` with a note.
 */
@Controller('alerts')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly rules: AlertRulesService,
    private readonly cases: CasesService,
  ) {}

  /**
   * `?type=CUSTOMER_PROBLEM&status=OPEN|RESOLVED&cursor&limit`: the cases as `{ items, nextCursor }`.
   * Any other type, or none, is the legacy array (cases left out), after re-evaluating the rules so the
   * office always sees the current state (deduplicated).
   */
  @Get()
  async list(@Query() raw: Record<string, unknown>, @CurrentActor() actor: UserActor) {
    if (raw?.type === CASE_ALERT_TYPE) {
      const query = parsedQuery(casesQuerySchema, raw);
      return this.cases.list({ status: query.status, cursor: query.cursor, limit: query.limit }, actor);
    }
    const query = parsedQuery(alertsQuerySchema, raw);
    await this.rules.evaluateAll();
    return this.alerts.list(query);
  }

  @Get('unread-count')
  async unread() {
    return { count: await this.alerts.unreadCount() };
  }

  /** `GET /alerts/mine` (the shop, exact): its own OPEN cases, oldest first, with no actions. */
  @Get('mine')
  @ExactRoles(UserRole.DISTRIBUTOR)
  async mine(@Query() raw: Record<string, unknown>, @CurrentActor() actor: UserActor) {
    const query = parsedQuery(myCasesQuerySchema, raw);
    return this.cases.mine(ownDistributorId(actor), { cursor: query.cursor, limit: query.limit }, actor);
  }

  /** `POST /alerts/:id/resolve` (office) `{ note }`: closes a case once, audited; no money. */
  @Post(':id/resolve')
  @HttpCode(200)
  resolveCase(@Param('id') id: string, @Body(new ZodBody(resolveCaseSchema)) body: ResolveCaseInput, @CurrentActor() actor: UserActor) {
    return this.cases.resolve(id, body.note, actor);
  }

  @Patch(':id/acknowledge')
  ack(@Param('id') id: string) {
    return this.alerts.acknowledge(id);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.alerts.resolve(id);
  }
}
