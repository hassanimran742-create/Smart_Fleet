import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@smartfleet/shared-types';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { deployedVersion } from '../../config/configuration';
import { SkipVersionGate } from '../../common/interceptors/app-version.interceptor';
import { PrismaService } from '../../prisma/prisma.service';

/** The database check may take this long before the API counts it as down (API_CONTRACT §7.2). */
export const HEALTH_DB_TIMEOUT_MS = 2_000;

export interface HealthReport {
  status: 'ok' | 'degraded';
  environment: AppEnvironment;
  version: string;
  uptimeSeconds: number;
  checks: { database: { ok: true; latencyMs: number } | { ok: false } };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Public health routes, never behind the app-update gate (API_CONTRACT §6, §7.2). Neither shows an
 * error text, a connection detail or NODE_ENV; the 503 body has the report's own shape, not the
 * error envelope.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ConfigService,
  ) {}

  /** `SELECT 1` within 2 seconds: 200 "ok", or 503 "degraded" while the database is down. */
  @Public()
  @SkipVersionGate()
  @Get()
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const started = Date.now();
    let database: HealthReport['checks']['database'];
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, HEALTH_DB_TIMEOUT_MS);
      database = { ok: true, latencyMs: Date.now() - started };
    } catch {
      database = { ok: false };
    }
    if (!database.ok) res.status(503);
    return {
      status: database.ok ? 'ok' : 'degraded',
      environment: this.cfg.get<AppEnvironment>('app.environment') ?? 'development',
      version: deployedVersion(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { database },
    };
  }

  /** 200 while the process runs; deploy health checks use it. */
  @Public()
  @SkipVersionGate()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
