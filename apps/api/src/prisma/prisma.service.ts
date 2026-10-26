import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The database client. It disconnects in `onApplicationShutdown`, which Nest runs after the HTTP
 * server has closed and its open requests have finished (`app.close()`: every `onModuleDestroy`, then
 * `beforeApplicationShutdown`, then the server closes, then `onApplicationShutdown`). Disconnecting in
 * `onModuleDestroy` cut off a request still inside a transaction when a deploy's SIGTERM arrived.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    await this.$connect();
  }
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
