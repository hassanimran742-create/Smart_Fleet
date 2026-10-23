import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { UPLOAD_MAX_MB, type FileUploadResult, type FileUrlResult } from '@smartfleet/shared-types';
import { fileUploadSchema, type FileUploadInput } from '@smartfleet/shared-validation';
import { catchError, throwError, type Observable } from 'rxjs';
import type { UserActor } from '../../common/auth/actor';
import { CurrentActor } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { ZodBody } from '../../common/pipes/zod-body.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { FilesService, UPLOAD_MAX_BYTES } from './files.service';

/** Multer's own refusals in the shared format: too big is FILE_TOO_LARGE, a wrong field is VALIDATION_FAILED. */
@Injectable()
export class UploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof PayloadTooLargeException) {
          return throwError(() => new AppError('FILE_TOO_LARGE', { maxMb: UPLOAD_MAX_MB }, { cause: error }));
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

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * Multipart `file` plus an optional `purpose` (API_CONTRACT §7.10): DISTRIBUTOR, DRIVER and the
   * office. Returns `{ fileId, key, url (signed 1 h), mimeType, size }`; installed apps read `url`.
   */
  @Post('upload')
  @Roles(UserRole.DISTRIBUTOR, UserRole.DRIVER)
  @RateLimit('files.upload', 30, 3600, 'user')
  @UseInterceptors(
    UploadErrorsInterceptor,
    // Busboy marks a file as over the limit once it reaches `fileSize` bytes, so the limit is one byte
    // past the maximum: exactly 5 MB (5,242,880 bytes) is accepted, one byte more is 413 (G15-03).
    FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES + 1, files: 1, fields: 10 } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodBody(fileUploadSchema)) body: FileUploadInput,
    @CurrentActor() actor: UserActor,
  ): Promise<FileUploadResult> {
    return this.files.upload(file, { purpose: body.purpose, actor });
  }

  /** A fresh 1-hour URL for the uploader or the office (FILE_NOT_FOUND for anyone else). */
  @Get(':id/url')
  async url(@Param('id') id: string, @CurrentActor() actor: UserActor): Promise<FileUrlResult> {
    return { url: await this.files.signedUrl(id, actor) };
  }
}
