import type { LoggerService } from '@nestjs/common';
import pino from 'pino';
import { deployedVersion } from '../../config/configuration';
import { RequestContext } from '../context/request-context';

type Env = Record<string, string | undefined>;

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.code',
  'req.body.otp',
  '*.cnic',
  '*.password',
  '*.codeHash',
  '*.tokenHash',
];

/** A stack trace as Nest passes it to `error(message, stack, context)`. */
const STACK = /^.+\n\s+at .+/s;

/** `LOG_LEVEL` when it is a pino level, else info (debug for local development). */
export function logLevelOf(env: Env = process.env): pino.LevelWithSilent {
  const wanted = (env.LOG_LEVEL ?? '').trim().toLowerCase();
  if (wanted === 'silent' || Object.prototype.hasOwnProperty.call(pino.levels.values, wanted)) return wanted as pino.LevelWithSilent;
  return isLocal(env) ? 'debug' : 'info';
}

/** Local development (NODE_ENV unset or development) prints readable lines; every server prints JSON. */
function isLocal(env: Env): boolean {
  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  return node === '' || node === 'development';
}

/**
 * The API's log stream: JSON lines on stdout (CloudWatch, Railway), readable lines in local
 * development, plus Better Stack when `BETTER_STACK_TOKEN` is set. `LOG_LEVEL` applies, and
 * credentials and CNICs are redacted.
 */
export const buildLogger = (env: Env = process.env): pino.Logger => {
  const level = logLevelOf(env);
  const options: pino.LoggerOptions = {
    level,
    base: {
      service: 'api',
      env: env.APP_ENV || env.NODE_ENV || 'development',
      version: deployedVersion(env),
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  const targets: pino.TransportTargetOptions[] = [];
  if (isLocal(env)) {
    targets.push({ target: 'pino-pretty', level, options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } });
  }
  if (env.BETTER_STACK_TOKEN) {
    if (!isLocal(env)) targets.push({ target: 'pino/file', level, options: { destination: 1 } });
    const host = env.BETTER_STACK_HOST || 'in.logs.betterstack.com';
    targets.push({ target: '@logtail/pino', level, options: { sourceToken: env.BETTER_STACK_TOKEN, options: { endpoint: `https://${host}` } } });
  }
  // Plain stdout needs no worker thread, so nothing is lost when the process exits.
  return targets.length > 0 ? pino(options, pino.transport({ targets })) : pino(options);
};

/**
 * Nest's logger on top of pino (main.ts): every line, the framework's included, goes out with its
 * context and, inside a request, its `requestId` (API_CONTRACT §2.2), at the level `LOG_LEVEL` allows.
 */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly pinoLogger: pino.Logger = buildLogger()) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  /**
   * Nest calls `log(message, context?)` and `error(message, stack?, context?)`: the last string that
   * isn't a stack is the context, a stack-shaped string is the stack.
   */
  private write(level: pino.Level, message: unknown, params: unknown[]): void {
    const rest = [...params];
    const last = rest[rest.length - 1];
    const context = typeof last === 'string' && !STACK.test(last) ? (rest.pop() as string) : undefined;
    const stack = rest.find((param): param is string => typeof param === 'string' && STACK.test(param));
    const requestId = RequestContext.requestId();
    const fields: Record<string, unknown> = {
      ...(context ? { context } : {}),
      ...(requestId ? { requestId } : {}),
      ...(stack ? { stack } : {}),
    };
    if (message instanceof Error) {
      this.pinoLogger[level]({ ...fields, err: message }, message.message);
    } else if (message !== null && typeof message === 'object') {
      this.pinoLogger[level]({ ...fields, ...(message as Record<string, unknown>) });
    } else {
      this.pinoLogger[level](fields, String(message));
    }
  }
}
