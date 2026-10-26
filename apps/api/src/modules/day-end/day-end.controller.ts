import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type PipeTransform,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import {
  DAY_SHEET_LIMITS,
  type AdminDayEndDetail,
  type AdminDayEndListItem,
  type DayEndApproveResult,
  type DayEndDayDto,
  type DayEndListItem,
  type DayEndUploadResult,
  type Page,
} from '@smartfleet/shared-types';
import {
  adminDayEndListQuerySchema,
  dayEndApproveSchema,
  dayEndListQuerySchema,
  dayEndReopenSchema,
  dayEndSendBackSchema,
  dayEndSubmitSchema,
  uuidSchema,
  type AdminDayEndListQuery,
  type DayEndApproveInput,
  type DayEndListQuery,
  type DayEndReopenInput,
  type DayEndSendBackInput,
  type DayEndSubmitInput,
} from '@smartfleet/shared-validation';
import type { Response } from 'express';
import { catchError, throwError, type Observable } from 'rxjs';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { ExactRoles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { SettingSwitch } from '../../common/features/feature';
import { RESPONSE_HEADER } from '../../common/http/headers';
import type { IdempotentResponse } from '../../common/idempotency/idempotency';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-body.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { DayEndOfficeService } from './day-end-office.service';
import { XLSX_MIME_TYPE } from './day-end-workbook';
import { DayEndService } from './day-end.service';

/** Seconds a busy answer asks the phone to wait before sending the file again. */
export const DAY_END_BUSY_RETRY_AFTER_SECONDS = 10;

/**
 * Multer's refusals in the contract's words: a file over 2 MiB is 413 FILE_TOO_LARGE `{ maxMb: 2 }`
 * (check 1, before the day is read), a wrong field is 400 VALIDATION_FAILED on `file`. The busy answer
 * (503 SERVICE_UNAVAILABLE, another file is being read) carries `Retry-After`.
 */
@Injectable()
export class DayEndUploadErrors implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (AppError.is(error, 'SERVICE_UNAVAILABLE')) {
          context.switchToHttp().getResponse<Response>().setHeader(RESPONSE_HEADER.retryAfter, String(DAY_END_BUSY_RETRY_AFTER_SECONDS));
          return throwError(() => error);
        }
        if (error instanceof PayloadTooLargeException) {
          return throwError(() => new AppError('FILE_TOO_LARGE', { maxMb: DAY_SHEET_LIMITS.maxMb }, { cause: error }));
        }
        if (error instanceof BadRequestException && !(error instanceof AppError)) {
          return throwError(
            () =>
              new AppError(
                'VALIDATION_FAILED',
                { fields: [{ path: 'file', code: 'INVALID_VALUE', message: validationMessage('INVALID_VALUE') }] },
                { cause: error },
              ),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}

/** An office `:id` must be a UUID; anything else is 404 DAY_NOT_FOUND, like an unknown day (§3.2). */
export class DayIdParam implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) throw new AppError('DAY_NOT_FOUND');
    return parsed.data.toLowerCase();
  }
}

/**
 * [Inc 3] The shop's day-end routes (API_CONTRACT §10.2): DISTRIBUTOR exact (no office bypass), the caller's
 * own days only. While `dayEnd.enabled` is off every route answers 403 FEATURE_DISABLED with
 * `X-Feature-Disabled: dayEnd` (a setting switch, §3.4), lists included.
 */
@Controller('day-end')
@SettingSwitch('dayEnd.enabled', 'dayEnd')
@ExactRoles(UserRole.DISTRIBUTOR)
export class DayEndController {
  constructor(private readonly dayEnd: DayEndService) {}

  @Get()
  list(@CurrentActor() actor: UserActor, @Query(new ZodQuery(dayEndListQuerySchema)) query: DayEndListQuery): Promise<Page<DayEndListItem>> {
    return this.dayEnd.list(actor, query);
  }

  @Get(':date')
  day(@CurrentActor() actor: UserActor, @Param('date') date: string): Promise<DayEndDayDto> {
    return this.dayEnd.day(actor, date);
  }

  /** A new sheet (exceljs). The first download for a date creates its day row. */
  @Get(':date/sheet.xlsx')
  @Header('Cache-Control', 'no-store')
  async sheet(@CurrentActor() actor: UserActor, @Param('date') date: string): Promise<StreamableFile> {
    const sheet = await this.dayEnd.sheet(actor, date);
    return new StreamableFile(sheet.bytes, {
      type: XLSX_MIME_TYPE,
      disposition: `attachment; filename="${sheet.fileName}"`,
      length: sheet.bytes.length,
    });
  }

  /**
   * Multipart field `file`. Busboy flags a file once it reaches `fileSize`, so exactly 2 MiB is accepted.
   * At most 20 uploads per 10 minutes per shop login (§3.6), counted before the body is read.
   */
  @Post(':date/upload')
  @HttpCode(200)
  @RateLimit('dayEnd.upload', 20, 600, 'user')
  @UseInterceptors(DayEndUploadErrors, FileInterceptor('file', { limits: { fileSize: DAY_SHEET_LIMITS.maxBytes + 1, files: 1, fields: 5 } }))
  upload(
    @CurrentActor() actor: UserActor,
    @Param('date') date: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<DayEndUploadResult> {
    return this.dayEnd.upload(actor, date, file);
  }

  @Post(':date/submit')
  @HttpCode(200)
  submit(
    @CurrentActor() actor: UserActor,
    @Param('date') date: string,
    @Body(new ZodBody(dayEndSubmitSchema)) body: DayEndSubmitInput,
  ): Promise<DayEndDayDto | IdempotentResponse<DayEndDayDto>> {
    return this.dayEnd.submit(actor, date, body);
  }
}

/** [Inc 3] The office's day-end routes (API_CONTRACT §10.2): office exact, behind the same switch. */
@Controller('admin/day-end')
@SettingSwitch('dayEnd.enabled', 'dayEnd')
@ExactRoles(UserRole.SUPER_ADMIN)
export class AdminDayEndController {
  constructor(private readonly office: DayEndOfficeService) {}

  @Get()
  list(@Query(new ZodQuery(adminDayEndListQuerySchema)) query: AdminDayEndListQuery): Promise<Page<AdminDayEndListItem>> {
    return this.office.list(query);
  }

  @Get(':id')
  detail(@Param('id', new DayIdParam()) id: string): Promise<AdminDayEndDetail> {
    return this.office.detail(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentActor() actor: UserActor,
    @Param('id', new DayIdParam()) id: string,
    @Body(new ZodBody(dayEndApproveSchema)) body: DayEndApproveInput,
  ): Promise<DayEndApproveResult | IdempotentResponse<DayEndApproveResult>> {
    return this.office.approve(actor, id, body);
  }

  @Post(':id/send-back')
  @HttpCode(200)
  sendBack(
    @CurrentActor() actor: UserActor,
    @Param('id', new DayIdParam()) id: string,
    @Body(new ZodBody(dayEndSendBackSchema)) body: DayEndSendBackInput,
  ): Promise<AdminDayEndDetail | IdempotentResponse<AdminDayEndDetail>> {
    return this.office.sendBack(actor, id, body);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(
    @CurrentActor() actor: UserActor,
    @Param('id', new DayIdParam()) id: string,
    @Body(new ZodBody(dayEndReopenSchema)) body: DayEndReopenInput,
  ): Promise<AdminDayEndDetail | IdempotentResponse<AdminDayEndDetail>> {
    return this.office.reopen(actor, id, body);
  }
}
