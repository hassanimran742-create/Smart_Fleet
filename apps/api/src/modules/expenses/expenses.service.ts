import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpenseCategory } from '@prisma/client';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  list(filter: { category?: ExpenseCategory; since?: Date; until?: Date } = {}) {
    return this.prisma.expense.findMany({
      where: {
        category: filter.category,
        expenseDate: {
          gte: filter.since,
          lte: filter.until,
        },
      },
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
  }

  async summary(since?: Date, until?: Date) {
    const all = await this.prisma.expense.findMany({
      where: { expenseDate: { gte: since, lte: until } },
    });
    const total = all.reduce((s, e) => s + e.amountPaisa, 0n);
    const byCategory: Record<string, { count: number; totalPaisa: bigint }> = {};
    for (const e of all) {
      const k = e.category;
      if (!byCategory[k]) byCategory[k] = { count: 0, totalPaisa: 0n };
      byCategory[k].count += 1;
      byCategory[k].totalPaisa += e.amountPaisa;
    }
    return {
      total: total.toString(),
      count: all.length,
      byCategory: Object.entries(byCategory).map(([category, v]) => ({
        category,
        count: v.count,
        totalPaisa: v.totalPaisa.toString(),
      })),
    };
  }

  create(input: {
    category: ExpenseCategory;
    description: string;
    amountPaisa: number;
    expenseDate: string;
    vendor?: string;
    notes?: string;
    receiptUrl?: string;
    recordedByUserId: string;
  }) {
    return this.prisma.expense.create({
      data: {
        category: input.category,
        description: input.description,
        amountPaisa: BigInt(input.amountPaisa),
        expenseDate: new Date(input.expenseDate),
        vendor: input.vendor,
        notes: input.notes,
        receiptUrl: input.receiptUrl,
        recordedByUserId: input.recordedByUserId,
      },
    });
  }

  update(
    id: string,
    input: { category?: ExpenseCategory; description?: string; amountPaisa?: number; expenseDate?: string; vendor?: string; notes?: string },
  ) {
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...input,
        amountPaisa: input.amountPaisa !== undefined ? BigInt(input.amountPaisa) : undefined,
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : undefined,
      },
    });
  }

  delete(id: string) {
    return this.prisma.expense.delete({ where: { id } });
  }
}
