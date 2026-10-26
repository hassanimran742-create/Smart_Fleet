/**
 * shared-types repeats the Prisma enums the apps read (README rule 2: the apps never import
 * @prisma/client), and shared-validation repeats them again in its private codes (its contract-sync
 * spec checks those against shared-types). This spec closes the loop: every mirror holds exactly the
 * values of its schema.prisma enum, so a new enum value fails here until the mirror follows.
 */
import * as prisma from '@prisma/client';
import * as types from '@smartfleet/shared-types';

const MIRRORED = [
  'UserRole',
  'UserStatus',
  'CylinderState',
  'CustodyType',
  'CylinderEventType',
  'VehicleStatus',
  'DriverAvailability',
  'OrderStatus',
  'OrderPaymentStatus',
  'OrderFeeStatus',
  'FeeStrategy',
  'DeliveryMethod',
  'TripStatus',
  'TripStopType',
  'TripStopStatus',
  'TransferStatus',
  'PaymentProviderName',
  'PaymentStatus',
  'PayerChannel',
  'LedgerEntryType',
  'DistributorStatus',
  'TicketStatus',
  'AuditActorKind',
  'StoredFilePurpose',
  'AlertSeverity',
  'AlertStatus',
  'AlertType',
  'AlertRuleKind',
  'FillingOrderStatus',
] as const;

const valuesOf = (source: unknown): string[] =>
  Object.values(source as Record<string, unknown>)
    .filter((value): value is string => typeof value === 'string')
    .sort();

describe('shared-types enum mirrors', () => {
  it.each(MIRRORED)('%s holds the schema.prisma values', (name) => {
    const fromPrisma = (prisma as unknown as Record<string, unknown>)[name];
    const fromShared = (types as unknown as Record<string, unknown>)[name];
    expect(fromPrisma).toBeDefined();
    expect(fromShared).toBeDefined();
    expect(valuesOf(fromShared)).toEqual(valuesOf(fromPrisma));
  });
});
