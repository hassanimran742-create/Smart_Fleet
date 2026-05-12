import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  list(cityId: string) {
    return this.prisma.pricingRule.findMany({
      where: { cityId, effectiveUntil: null },
      orderBy: [{ originZoneId: 'asc' }, { destZoneId: 'asc' }],
    });
  }

  async upsertRule(input: {
    cityId: string;
    originZoneId: string;
    destZoneId: string;
    cylinderTypeId: string;
    basePaisa: number;
    perUnitPaisa: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.pricingRule.updateMany({
        where: {
          cityId: input.cityId,
          originZoneId: input.originZoneId,
          destZoneId: input.destZoneId,
          cylinderTypeId: input.cylinderTypeId,
          effectiveUntil: null,
        },
        data: { effectiveUntil: now },
      });
      return tx.pricingRule.create({
        data: { ...input, effectiveFrom: now },
      });
    });
  }

  async findActive(input: {
    cityId: string;
    originZoneId: string;
    destZoneId: string;
    cylinderTypeId: string;
    at?: Date;
  }) {
    const at = input.at ?? new Date();
    const rule = await this.prisma.pricingRule.findFirst({
      where: {
        cityId: input.cityId,
        originZoneId: input.originZoneId,
        destZoneId: input.destZoneId,
        cylinderTypeId: input.cylinderTypeId,
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
    });
    if (!rule) throw new NotFoundException('PRICING_NOT_CONFIGURED');
    return rule;
  }

  async computeFeePaisa(opts: {
    cityId: string;
    originZoneId: string;
    destZoneId: string;
    lines: { cylinderTypeId: string; fullCount: number }[];
  }) {
    let total = 0n;
    for (const line of opts.lines) {
      const rule = await this.findActive({
        cityId: opts.cityId,
        originZoneId: opts.originZoneId,
        destZoneId: opts.destZoneId,
        cylinderTypeId: line.cylinderTypeId,
      });
      total += rule.basePaisa + rule.perUnitPaisa * BigInt(line.fullCount);
    }
    return total;
  }
}
