import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const t = Date.now();
    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - t;
        this.logger.log(`${req.method} ${req.url} ${ms}ms`);
      }),
    );
  }
}
