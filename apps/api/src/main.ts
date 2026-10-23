import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { installBigIntJson } from './common/bootstrap/bigint-json';
import { bootRefusalLine, checkBootEnvironment } from './common/bootstrap/boot-guards';
import { configureApp } from './common/bootstrap/configure-app';
import { PinoLoggerService } from './common/logging/logger';
import { initSentry } from './common/sentry/sentry';
import { deployedVersion } from './config/configuration';

// Paisa and counters are BigInt; JSON carries them as digit strings (API_CONTRACT §1.1).
installBigIntJson();

async function bootstrap() {
  // Boot guards (API_CONTRACT §3.7) run before anything connects: one line, exit code 1.
  const problems = checkBootEnvironment(process.env);
  if (problems.length > 0) {
    console.error(bootRefusalLine(problems));
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 500).unref();
    return;
  }

  initSentry();

  // Every line, the framework's included, goes through pino: JSON with the request id, LOG_LEVEL applies.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: new PinoLoggerService() });
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get<number>('api.port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `Smart_Fleet API listening on :${port} (env=${config.get<string>('app.environment') ?? 'development'}, version=${deployedVersion()})`,
    'Bootstrap',
  );
  // A browser blocks the website without a word when its origin isn't listed, so say which ones are.
  const origins = config.get<string[]>('cors.origins') ?? [];
  Logger.log(`CORS origins: ${origins.length > 0 ? origins.join(', ') : 'any (CORS_ORIGINS is not set)'}`, 'Bootstrap');
}

bootstrap();
