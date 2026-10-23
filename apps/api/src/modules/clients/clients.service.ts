import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ClientAddressCreateResult,
  ClientAddressDto,
  ClientCreateResult,
  ClientDto,
  IdName,
  LocationQuote,
  PriceStatus,
} from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import type { ClientAddressInput, CreateClientInput } from '@smartfleet/shared-validation';
import { canSeeClient, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { assertSameRequest, replayed, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { LOCKING_TX, type Db, type Tx } from '../orders/support/tx';
import { PricingService } from '../pricing/pricing.service';

/** A row of `GET /clients`: the ClientDto plus the free-text fields installed 0.1.0 apps still read. */
export interface ClientRow extends ClientDto {
  /** Legacy free-text address (installed apps); new apps use `addresses`. */
  address: string | null;
  /** Legacy, no longer written. */
  city: string | null;
}

/** `POST /clients`: the contract's result, plus `id`, `name` and `phone` for the installed app. */
export type ClientCreateResponse = ClientCreateResult & { id: string; name: string; phone: string };

interface LiveAddressRow {
  id: string;
  client_id: string;
  label: string;
  lat: number;
  lng: number;
  zone_id: string | null;
  zone_name: string | null;
  priced: boolean;
}

function priceStatusOf(row: LiveAddressRow): PriceStatus {
  if (!row.zone_id) return 'OUTSIDE';
  return row.priced ? 'SET' : 'NOT_SET';
}

function toAddressDto(row: LiveAddressRow): ClientAddressDto {
  return {
    id: row.id,
    label: row.label,
    lat: row.lat,
    lng: row.lng,
    zone: row.zone_id ? { id: row.zone_id, name: row.zone_name as string } : null,
    priceStatus: priceStatusOf(row),
  };
}

/** A blocked pin answers 422 with its own code (API_CONTRACT §7.4 rule 3). */
function assertServiceable(quote: LocationQuote): asserts quote is LocationQuote & { zone: IdName; price: NonNullable<LocationQuote['price']> } {
  if (quote.blockCode === 'PRICING_ZONE_NOT_COVERED') throw new AppError('PRICING_ZONE_NOT_COVERED');
  if (quote.blockCode === 'PRICING_PRICE_NOT_SET' || !quote.zone || !quote.price) {
    throw new AppError('PRICING_PRICE_NOT_SET', { zoneId: quote.zone?.id ?? '', zoneName: quote.zone?.name ?? '' });
  }
}

/**
 * Customers (API_CONTRACT §7.4): a distributor's own data. Phones are stored normalised and unique
 * within the distributor; an address must be covered by an active zone with this distributor's price.
 * Adding a customer or an address writes no audit row (Appendix B).
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /** `GET /clients` (a bare array, newest first), each address with its live zone and price status. */
  async list(distributorId: string): Promise<ClientRow[]> {
    const clients = await this.prisma.client.findMany({
      where: { distributorId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, name: true, phone: true, area: true, notes: true, address: true, city: true },
    });
    if (clients.length === 0) return [];
    const byClient = new Map<string, ClientAddressDto[]>();
    for (const row of await this.liveAddresses(this.prisma, distributorId)) {
      const list = byClient.get(row.client_id) ?? [];
      list.push(toAddressDto(row));
      byClient.set(row.client_id, list);
    }
    return clients.map((client) => ({
      id: client.id,
      name: client.name,
      phone: client.phone,
      area: client.area,
      notes: client.notes,
      addresses: byClient.get(client.id) ?? [],
      address: client.address,
      city: client.city,
    }));
  }

  /**
   * `POST /clients` (DISTRIBUTOR exact, Idempotency-Key). In order: the key (a retry gets the first
   * customer back, compared on name and phone); the phone (400 CLIENT_PHONE_INVALID); unique within
   * the distributor (409 CLIENT_PHONE_EXISTS, checked again under the distributor-row lock); with an
   * address, its coverage (422). The customer and the address are saved in one transaction.
   */
  async create(
    distributorId: string,
    body: CreateClientInput,
    key: string | undefined,
  ): Promise<ClientCreateResponse | IdempotentResponse<ClientCreateResponse>> {
    if (key) {
      const existing = await this.prisma.client.findUnique({
        where: { distributorId_clientRequestId: { distributorId, clientRequestId: key } },
        select: { id: true },
      });
      if (existing) return replayed(await this.replay(distributorId, existing.id, body));
    }

    const phone = normalizePkPhone(body.phone);
    if (!phone) throw new AppError('CLIENT_PHONE_INVALID');
    await this.assertPhoneFree(this.prisma, distributorId, phone);

    let quote: LocationQuote | null = null;
    if (body.address) {
      quote = await this.pricing.quoteLocation(distributorId, body.address);
      assertServiceable(quote);
    }

    let created: { clientId: string; addressId: string | null };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Two adds of one number at the same moment: the second waits here, then sees the first.
        await tx.$queryRaw`SELECT id FROM distributors WHERE id = ${distributorId}::uuid FOR UPDATE`;
        await this.assertPhoneFree(tx, distributorId, phone);
        const client = await tx.client.create({
          data: {
            distributorId,
            name: body.name,
            phone,
            area: body.area ?? null,
            notes: body.notes ?? null,
            address: body.legacyAddressText ?? null,
            clientRequestId: key ?? null,
          },
          select: { id: true },
        });
        const addressId = body.address && quote?.zone ? await this.insertAddress(tx, client.id, body.address, quote.zone.id) : null;
        return { clientId: client.id, addressId };
      }, LOCKING_TX);
    } catch (error) {
      if (key && isUniqueViolation(error, 'clients_distributor_id_client_request_id_key')) {
        const first = await this.prisma.client.findUnique({
          where: { distributorId_clientRequestId: { distributorId, clientRequestId: key } },
          select: { id: true },
        });
        if (first) return replayed(await this.replay(distributorId, first.id, body));
      }
      if (isUniqueViolation(error, 'clients_distributor_id_phone_key')) await this.assertPhoneFree(this.prisma, distributorId, phone);
      throw error;
    }

    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: created.clientId },
      select: { id: true, name: true, phone: true, area: true, notes: true },
    });
    const address =
      created.addressId && body.address && quote?.zone
        ? { id: created.addressId, label: body.address.label, lat: body.address.lat, lng: body.address.lng, zone: quote.zone }
        : null;
    return { id: client.id, name: client.name, phone: client.phone, client, address, price: quote?.price ?? null };
  }

  /** `GET /clients/:id/addresses`: the owner, or the office reading; each with its live zone and price. */
  async listAddresses(caller: PolicyCaller, clientId: string): Promise<ClientAddressDto[]> {
    const client = canSeeClient(caller, await this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true, distributorId: true } }));
    return (await this.liveAddresses(this.prisma, client.distributorId, client.id)).map(toAddressDto);
  }

  /** `POST /clients/:id/addresses` (owner only): the same coverage check as adding a customer. */
  async addAddress(caller: PolicyCaller, clientId: string, body: ClientAddressInput): Promise<ClientAddressCreateResult> {
    const client = canSeeClient(
      caller,
      await this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true, distributorId: true } }),
      { access: 'write' },
    );
    const quote = await this.pricing.quoteLocation(client.distributorId, body);
    assertServiceable(quote);
    const id = await this.prisma.$transaction((tx) => this.insertAddress(tx, client.id, body, quote.zone.id));
    return { id, label: body.label, lat: body.lat, lng: body.lng, zone: quote.zone, price: quote.price, ok: true };
  }

  // ---------- internals ----------

  private async assertPhoneFree(db: Db, distributorId: string, phone: string): Promise<void> {
    const existing = await db.client.findFirst({
      where: { distributorId, phone },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (existing) throw new AppError('CLIENT_PHONE_EXISTS', { clientId: existing.id, name: existing.name });
  }

  private async insertAddress(tx: Tx, clientId: string, address: ClientAddressInput, zoneId: string): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO client_addresses (id, client_id, label, location, zone_id, created_at)
      VALUES (gen_random_uuid(), ${clientId}::uuid, ${address.label},
              ST_SetSRID(ST_MakePoint(${address.lng}, ${address.lat}), 4326), ${zoneId}::uuid, (now() AT TIME ZONE 'UTC'))
      RETURNING id`;
    return rows[0].id;
  }

  /**
   * Addresses with the zone covering each pin now (active zones only, the one lookup rule) and this
   * distributor's price there: one query, never the stored `zone_id` (API_CONTRACT §7.4).
   */
  private liveAddresses(db: Db, distributorId: string, clientId?: string): Promise<LiveAddressRow[]> {
    const onlyClient = clientId ? Prisma.sql`AND a.client_id = ${clientId}::uuid` : Prisma.empty;
    return db.$queryRaw<LiveAddressRow[]>`
      SELECT a.id, a.client_id, a.label, ST_Y(a.location) AS lat, ST_X(a.location) AS lng,
             z.id AS zone_id, z.name AS zone_name, (p.id IS NOT NULL) AS priced
      FROM client_addresses a
      JOIN clients c ON c.id = a.client_id
      LEFT JOIN LATERAL (
        SELECT zz.id, zz.name FROM zones zz
        WHERE zz.is_active AND ST_Covers(zz.polygon, a.location)
        ORDER BY ST_Area(zz.polygon), zz.created_at, zz.id
        LIMIT 1
      ) z ON TRUE
      LEFT JOIN distributor_zone_prices p ON p.distributor_id = c.distributor_id AND p.zone_id = z.id
      WHERE c.distributor_id = ${distributorId}::uuid ${onlyClient}
      ORDER BY a.created_at, a.id`;
  }

  /**
   * A retried `POST /clients`: the key fields (name, normalised phone) must match the first request
   * (409 IDEMPOTENCY_CONFLICT otherwise); the answer is the first customer, its first address and
   * today's price there.
   */
  private async replay(distributorId: string, clientId: string, body: CreateClientInput): Promise<ClientCreateResponse> {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { id: true, name: true, phone: true, area: true, notes: true },
    });
    assertSameRequest(
      { name: client.name, phone: client.phone },
      { name: body.name, phone: normalizePkPhone(body.phone) ?? body.phone },
      ['name', 'phone'],
    );
    const first = (await this.liveAddresses(this.prisma, distributorId, clientId))[0];
    let address: ClientCreateResult['address'] = null;
    let price: ClientCreateResult['price'] = null;
    if (first) {
      const quote = await this.pricing.quoteLocation(distributorId, { lat: first.lat, lng: first.lng });
      price = quote.price;
      const stored = await this.prisma.clientAddress.findUnique({ where: { id: first.id }, select: { zone: { select: { id: true, name: true } } } });
      const zone = quote.zone ?? stored?.zone ?? null;
      address = zone ? { id: first.id, label: first.label, lat: first.lat, lng: first.lng, zone } : null;
    }
    return { id: client.id, name: client.name, phone: client.phone, client, address, price };
  }
}
