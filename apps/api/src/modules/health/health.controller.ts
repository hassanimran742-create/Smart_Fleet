import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private cfg: ConfigService,
  ) {}

  @Public()
  @Get()
  async health() {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    const t0 = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      checks.database = { ok: false, error: e.message };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    return {
      status: allOk ? 'ok' : 'degraded',
      env: process.env.NODE_ENV ?? 'unknown',
      version: process.env.GIT_COMMIT_SHA ?? 'dev',
      uptimeSeconds: Math.floor(process.uptime()),
      checks,
    };
  }

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
