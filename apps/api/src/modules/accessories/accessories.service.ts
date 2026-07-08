import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessoryCategory, AccessoryMovementReason } from '@prisma/client';

@Injectable()
export class AccessoriesService {
  constructor(private prisma: PrismaService) {}

  list(opts: { includeInactive?: boolean } = {}) {
    return this.prisma.accessory.findMany({
      where: opts.includeInactive ? {} : { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  byId(id: string) {
    return this.prisma.accessory.findUnique({ where: { id } });
  }

  create(input: {
    code: string;
    name: string;
    category: AccessoryCategory;
    unit: string;
    defaultPricePaisa?: number;
  }) {
    return this.prisma.accessory.create({
      data: {
        code: input.code,
        name: input.name,
        category: input.category,
        unit: input.unit,
        defaultPricePaisa: BigInt(input.defaultPricePaisa ?? 0),
      },
    });
  }

  update(
    id: string,
    input: {
      name?: string;
      category?: AccessoryCategory;
      unit?: string;
      defaultPricePaisa?: number;
      isActive?: boolean;
    },
  ) {
    return this.prisma.accessory.update({
      where: { id },
      data: {
        ...input,
        defaultPricePaisa:
          input.defaultPricePaisa !== undefined ? BigInt(input.defaultPricePaisa) : undefined,
      },
    });
  }

  archive(id: string) {
    return this.prisma.accessory.update({ where: { id }, data: { isActive: false } });
  }

  reactivate(id: string) {
    return this.prisma.accessory.update({ where: { id }, data: { isActive: true } });
  }

  // ----- Stock -----

  stockForStore(storeId: string) {
    return this.prisma.accessoryStock.findMany({
      where: { storeId },
      include: { accessory: true },
      orderBy: { accessory: { name: 'asc' } },
    });
  }

  movementsForStore(storeId: string) {
    return this.prisma.accessoryMovement.findMany({
      where: { storeId },
      include: { accessory: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async adjustStock(input: {
    storeId: string;
    accessoryId: string;
    delta: number;
    reason: AccessoryMovementReason;
    note?: string;
    unitPricePaisa?: number;
    actorUserId: string;
  }) {
    const acc = await this.prisma.accessory.findUnique({ where: { id: input.accessoryId } });
    if (!acc) throw new NotFoundException('Accessory not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.accessoryStock.upsert({
        where: {
          storeId_accessoryId: {
            storeId: input.storeId,
            accessoryId: input.accessoryId,
          },
        },
        update: {
          quantity: { increment: input.delta },
          unitPricePaisa:
            input.unitPricePaisa !== undefined ? BigInt(input.unitPricePaisa) : undefined,
        },
        create: {
          storeId: input.storeId,
          accessoryId: input.accessoryId,
          quantity: input.delta,
          unitPricePaisa:
            input.unitPricePaisa !== undefined ? BigInt(input.unitPricePaisa) : undefined,
        },
      });
      return tx.accessoryMovement.create({
        data: {
          storeId: input.storeId,
          accessoryId: input.accessoryId,
          delta: input.delta,
          reason: input.reason,
          note: input.note,
          actorUserId: input.actorUserId,
        },
      });
    });
  }
}
