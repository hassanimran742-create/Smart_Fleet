import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { stripSecrets } from '../security/strip-secrets';

/**
 * Global: removes `passwordHash`, `cnic`, `cnicEncrypted`, `cnicIndex`, `codeHash` and `tokenHash`
 * from every HTTP response body, at any depth (API_CONTRACT §3.5). Services still use explicit
 * `select`s; this is the net under them.
 */
@Injectable()
export class SecretStripInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(map((body: unknown) => stripSecrets(body)));
  }
}
