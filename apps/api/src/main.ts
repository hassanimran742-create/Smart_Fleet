import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ConfigService } from '@nestjs/config';

// Teach BigInt how to JSON-serialise. Prisma returns paisa-denominated
// money columns and other large counters as BigInt; without this patch
// every response that includes one throws
// "Do not know how to serialize a BigInt".
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1');

  const port = config.get<number>('api.port') ?? 3000;
  await app.listen(port);
  Logger.log(`Smart_Fleet API listening on :${port}`, 'Bootstrap');
}

bootstrap();
