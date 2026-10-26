import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppSeenService } from '../../common/app-seen/app-seen.service';
import { CryptoModule } from '../../common/crypto/crypto.module';
import configuration from '../../config/configuration';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SessionCheckService } from '../auth/session-check.service';
import { CitiesService } from '../cities/cities.service';
import { ClientsService } from '../clients/clients.service';
import { ConfirmationService } from '../confirmation/confirmation.contract';
import { ScanService } from '../custody/scan.service';
import { CylinderTypesService } from '../cylinder-types/cylinder-types.service';
import { DistributorsService } from '../distributors/distributors.service';
import { DriversService } from '../drivers/drivers.service';
import { FillingStationsService } from '../filling-stations/filling-stations.service';
import { DistributorZoneStrategy } from '../pricing/distributor-zone.strategy';
import { PricingService } from '../pricing/pricing.service';
import { ZonePriceLookup } from '../pricing/zone-price.lookup';
import { SettingsModule } from '../settings/settings.module';
import { StoresService } from '../stores/stores.service';
import { CnicVault } from '../users/cnic-vault.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WalletService } from '../wallet/wallet.service';
import { ZonesService } from '../zones/zones.service';
import { PilotResetService } from './reset/pilot-reset.service';
import { PilotSetupService } from './setup/pilot-setup.service';
import { transactionAware } from './tx-scope';

/**
 * The database client of the setup CLI: the usual PrismaService, made transaction-aware (tx-scope.ts),
 * so every service below writes into the run's one transaction. Global, like the API's PrismaModule,
 * which the setup module doesn't load.
 */
@Global()
@Module({
  providers: [{ provide: PrismaService, useFactory: () => transactionAware(new PrismaService()) }],
  exports: [PrismaService],
})
class SetupPrismaModule {}

/**
 * Customers are added with the normal rules (ClientsService.create); the confirmation service is only
 * consulted when a customer's phone is edited, which setup never does.
 */
const NO_CONFIRMATIONS: Pick<ConfirmationService, 'hasPendingForClient'> = {
  hasPendingForClient: async () => false,
};

/**
 * `npm run pilot:setup` (API_CONTRACT §10.3, no HTTP): the services the setup writes through, wired
 * without their HTTP modules (no controllers, guards, sockets, queues or jobs start in a CLI).
 * AppSeenService is the office views' reader of each user's app (DistributorsService and DriversService
 * build their DTOs with it); the setup makes no app call, so it records nothing.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), SetupPrismaModule, CryptoModule, SettingsModule, AuditLogModule],
  providers: [
    ZonesService,
    StoresService,
    CitiesService,
    CylinderTypesService,
    ZonePriceLookup,
    DistributorZoneStrategy,
    PricingService,
    WalletService,
    SessionCheckService,
    AppSeenService,
    DistributorsService,
    CnicVault,
    DriversService,
    VehiclesService,
    FillingStationsService,
    { provide: ConfirmationService, useValue: NO_CONFIRMATIONS },
    ClientsService,
    ScanService,
    PilotSetupService,
  ],
})
export class PilotSetupCliModule {}

/** `npm run pilot:reset` (API_CONTRACT §10.3, no HTTP): the plain database client and the audit log. */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), PrismaModule, SettingsModule, AuditLogModule],
  providers: [PilotResetService],
})
export class PilotResetCliModule {}
