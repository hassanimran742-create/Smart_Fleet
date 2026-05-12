import { Injectable, NotFoundException } from '@nestjs/common';
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

  async create(distributorId: string, input: { name: string; phone: string }) {
    return this.prisma.client.create({
      data: { distributorId, name: input.name, phone: input.phone },
    });
  }

  async addAddress(
    clientId: string,
    input: { label: string; lat: number; lng: number },
  ) {
    const exists = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!exists) throw new NotFoundException();
    // Spatial column written via raw SQL
    await this.prisma.$executeRaw`
      INSERT INTO client_addresses (id, client_id, label, location)
      VALUES (gen_random_uuid(), ${clientId}::uuid, ${input.label},
              ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326))
    `;
    return { ok: true };
  }
}
