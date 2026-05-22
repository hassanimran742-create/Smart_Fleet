import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  listForDistributor(distributorId: string) {
    return this.prisma.client.findMany({
      where: { distributorId },
      include: { addresses: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(distributorId: string, input: {
    name: string;
    phone: string;
    address?: string;
    area?: string;
    city?: string;
    creditLimitRs?: number | string;
    priority?: number;
    notes?: string;
  }) {
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    if (!input.phone?.trim()) throw new BadRequestException('Phone is required');

    // Dedupe by (distributor, phone). Same distributor can't have two clients
    // with the same number; admin web enforces this as well.
    const existing = await this.prisma.client.findFirst({
      where: { distributorId, phone: input.phone.trim() },
    });
    if (existing) {
      throw new BadRequestException(
        `A client with phone ${input.phone} already exists (${existing.name}). Pick them from the list instead.`,
      );
    }

    return this.prisma.client.create({
      data: {
        distributorId,
        name: input.name.trim(),
        phone: input.phone.trim(),
        address: input.address?.trim() || null,
        area: input.area?.trim() || null,
        city: input.city?.trim() || null,
        creditLimitPaisa: input.creditLimitRs != null ? BigInt(Math.round(Number(input.creditLimitRs) * 100)) : 0n,
        priority: input.priority ?? 3,
        notes: input.notes?.trim() || null,
      },
    });
  }

  async addAddress(
    clientId: string,
    input: { label: string; lat: number; lng: number },
  ) {
    const exists = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!exists) throw new NotFoundException();
    // Spatial column written via raw SQL
    const rows: { id: string }[] = await this.prisma.$queryRaw`
      INSERT INTO client_addresses (id, client_id, label, location)
      VALUES (gen_random_uuid(), ${clientId}::uuid, ${input.label},
              ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326))
      RETURNING id
    `;
    return { id: rows[0].id, ok: true };
  }

  // Returns saved addresses with lat/lng decoded for the mobile picker.
  async listAddresses(clientId: string) {
    const rows: Array<{ id: string; label: string; lat: number; lng: number }> =
      await this.prisma.$queryRaw`
        SELECT id, label, ST_Y(location) AS lat, ST_X(location) AS lng
        FROM client_addresses
        WHERE client_id = ${clientId}::uuid
        ORDER BY label
      `;
    return rows;
  }
}
