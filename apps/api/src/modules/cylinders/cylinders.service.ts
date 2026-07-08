import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustodyType } from '@prisma/client';
import { randomBytes } from 'crypto';

@Injectable()
export class CylindersService {
  constructor(private prisma: PrismaService) {}

  async findByQr(qr: string) {
    const c = await this.prisma.cylinder.findUnique({
      where: { qrCode: qr },
      include: { cylinderType: true, distributor: true },
    });
    if (!c) throw new NotFoundException();
    return c;
  }

  list(distributorId?: string) {
    return this.prisma.cylinder.findMany({
      where: distributorId ? { distributorId } : undefined,
      include: { cylinderType: true },
      take: 200,
    });
  }

  /**
   * Register cylinders against a distributor and place them at an
   * initial custody (typically a store, FULL).
   *
   * The caller can either:
   * - supply explicit serials (one row per QR-coded cylinder), or
   * - supply just a quantity, in which case serials are auto-generated.
   *
   * Auto-generated serials use the cylinder-type code + a short random
   * suffix, e.g. LPG_11_8KG-7G4F9C2A. Replace later with whatever
   * encoding scheme you adopt for printed QR labels.
   */
  async bulkRegister(input: {
    distributorId: string;
    cylinderTypeId: string;
    serials?: string[];
    quantity?: number;
    initialCustodyType: CustodyType;
    initialCustodyId: string;
  }) {
    let serials = input.serials?.filter(Boolean) ?? [];

    if (serials.length === 0) {
      const qty = Math.floor(input.quantity ?? 0);
      if (qty <= 0) {
        throw new BadRequestException(
          'Provide either serials[] or a positive quantity to register cylinders.',
        );
      }
      if (qty > 5000) {
        throw new BadRequestException('Quantity capped at 5000 per registration.');
      }
      const type = await this.prisma.cylinderType.findUnique({
        where: { id: input.cylinderTypeId },
      });
      if (!type) throw new NotFoundException('cylinderTypeId not found');

      serials = Array.from({ length: qty }, () => {
        const suffix = randomBytes(4).toString('hex').toUpperCase();
        return `${type.code}-${suffix}`;
      });
    }

    const count = serials.length;

    return this.prisma.$transaction(async (tx) => {
      // 1) Create the cylinder records (each starts FULL at the initial holder).
      const created = [];
      for (const serial of serials) {
        created.push(
          await tx.cylinder.create({
            data: {
              serial,
              qrCode: serial,
              distributorId: input.distributorId,
              cylinderTypeId: input.cylinderTypeId,
              custodyType: input.initialCustodyType,
              custodyId: input.initialCustodyId,
              state: 'FULL',
            },
          }),
        );
      }

      // 2) Seed the inventory ledger so store/holder counts are correct.
      //    Without this, inventory_lots stays empty and every later scan
      //    decrements a non-existent lot into the negatives.
      await tx.inventoryLot.upsert({
        where: {
          inventory_unique: {
            holderType: input.initialCustodyType,
            holderId: input.initialCustodyId,
            distributorId: input.distributorId,
            cylinderTypeId: input.cylinderTypeId,
            state: 'FULL',
          },
        },
        update: { count: { increment: count } },
        create: {
          holderType: input.initialCustodyType,
          holderId: input.initialCustodyId,
          distributorId: input.distributorId,
          cylinderTypeId: input.cylinderTypeId,
          state: 'FULL',
          count,
        },
      });

      // Return the created rows (QR generator renders these).
      return created;
    });
  }
}
