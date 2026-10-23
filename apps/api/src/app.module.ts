import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';

import { CommonModule } from './common/common.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { RequestLogMiddleware } from './common/logging/request-log.middleware';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency';
import { AppVersionInterceptor } from './common/interceptors/app-version.interceptor';
import { SecretStripInterceptor } from './common/interceptors/secret-strip.interceptor';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { FilesModule } from './modules/files/files.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { AdminSummaryModule } from './modules/admin-summary/admin-summary.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DistributorsModule } from './modules/distributors/distributors.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { ZonesModule } from './modules/zones/zones.module';
import { StoresModule } from './modules/stores/stores.module';
import { CylinderTypesModule } from './modules/cylinder-types/cylinder-types.module';
import { CylindersModule } from './modules/cylinders/cylinders.module';
import { CustodyModule } from './modules/custody/custody.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { OrdersModule } from './modules/orders/orders.module';
import { TripsModule } from './modules/trips/trips.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { RoutingModule } from './modules/routing/routing.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SupportModule } from './modules/support/support.module';
import { SmsModule } from './modules/sms/sms.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { PushTokensModule } from './modules/push-tokens/push-tokens.module';
import { CitiesModule } from './modules/cities/cities.module';
import { AccessoriesModule } from './modules/accessories/accessories.module';
import { FillingStationsModule } from './modules/filling-stations/filling-stations.module';
import { FillingOrdersModule } from './modules/filling-orders/filling-orders.module';
import { FuelRefillsModule } from './modules/fuel-refills/fuel-refills.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ClientPortalModule } from './modules/client-portal/client-portal.module';
import { HealthModule } from './modules/health/health.module';
import { HousekeepingModule } from './modules/housekeeping/housekeeping.module';
import { CryptoModule } from './common/crypto/crypto.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Staging and production share one Redis today: every queue key carries BULLMQ_PREFIX.
        const prefix = config.get<string>('bullmq.prefix');
        const url = config.get<string>('redis.url');
        if (url) {
          // BullMQ/ioredis accept a connection string; required for Upstash TLS.
          return { prefix, connection: { url, tls: url.startsWith('rediss://') ? {} : undefined } as any };
        }
        return {
          prefix,
          connection: {
            host: config.get<string>('redis.host') ?? 'localhost',
            port: config.get<number>('redis.port') ?? 6379,
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    CommonModule,
    // Foundation (Inc 1): global settings and audit, files, the wallet and the office summary.
    SettingsModule,
    AuditLogModule,
    FilesModule,
    WalletModule,
    AdminSummaryModule,
    HealthModule,
    HousekeepingModule,
    SmsModule,
    AuthModule,
    UsersModule,
    DistributorsModule,
    ClientsModule,
    DriversModule,
    VehiclesModule,
    ZonesModule,
    StoresModule,
    CylinderTypesModule,
    CylindersModule,
    CustodyModule,
    InventoryModule,
    TransfersModule,
    PricingModule,
    OrdersModule,
    TripsModule,
    DispatchModule,
    RoutingModule,
    PaymentsModule,
    LedgerModule,
    ReconciliationModule,
    ReturnsModule,
    NotificationsModule,
    ReportsModule,
    SupportModule,
    AlertsModule,
    PushTokensModule,
    CitiesModule,
    AccessoriesModule,
    FillingStationsModule,
    FillingOrdersModule,
    FuelRefillsModule,
    ExpensesModule,
    ClientPortalModule,
  ],
  providers: [
    // The §2.1 error envelope for everything thrown.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Remaining class-validator DTOs; zod bodies use ZodBody per parameter.
    { provide: APP_PIPE, useFactory: createValidationPipe },
    // Interceptors run in this order on the way in, and in reverse on the way out:
    // the 426 update gate first; secrets stripped from the final body; replay headers innermost.
    { provide: APP_INTERCEPTOR, useClass: AppVersionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: SecretStripInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The request context first (request id, list key), then one log line per request.
    consumer.apply(RequestContextMiddleware, RequestLogMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
