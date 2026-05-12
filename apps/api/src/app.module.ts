import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';

import { PrismaModule } from './prisma/prisma.module';
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
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { SmsModule } from './modules/sms/sms.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
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
    AuditLogModule,
  ],
})
export class AppModule {}
