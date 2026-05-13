import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributorStatus, UserRole, UserStatus } from '@prisma/client';

@Injectable()
export class DistributorsService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.distributor.findMany({ include: { user: true, homeStore: true } });
  }

  async findById(id: string) {
    const d = await this.prisma.distributor.findUnique({
      where: { id },
      include: { user: true, homeStore: true },
    });
    if (!d) throw new NotFoundException();
    return d;
  }

  async create(input: {
    phone: string;
    name: string;
    businessName: string;
    homeStoreId?: string | null;
    email?: string | null;
  }) {
    if (!input.phone?.trim()) throw new BadRequestException('phone is required');
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    if (!input.businessName?.trim()) throw new BadRequestException('businessName is required');

    // Sanitize: empty strings cause Prisma FK / UUID errors. Coerce to undefined.
    const homeStoreId = input.homeStoreId?.trim() ? input.homeStoreId.trim() : undefined;
    const email = input.email?.trim() ? input.email.trim() : undefined;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone: input.phone },
        update: { name: input.name, role: UserRole.DISTRIBUTOR, email },
        create: {
          phone: input.phone,
          name: input.name,
          role: UserRole.DISTRIBUTOR,
          status: UserStatus.PENDING,
          email,
        },
      });
      return tx.distributor.create({
        data: {
          userId: user.id,
          businessName: input.businessName,
          homeStoreId,
          status: DistributorStatus.PENDING,
        },
        include: { user: true, homeStore: true },
      });
    });
  }

  approve(id: string) {
    return this.prisma.distributor.update({
      where: { id },
      data: {
        status: DistributorStatus.ACTIVE,
        user: { update: { status: UserStatus.ACTIVE } },
      },
    });
  }

  suspend(id: string) {
    return this.prisma.distributor.update({
      where: { id },
      data: { status: DistributorStatus.SUSPENDED },
    });
  }

  async update(
    id: string,
    input: { businessName?: string; homeStoreId?: string; name?: string; email?: string; phone?: string },
  ) {
    const dist = await this.prisma.distributor.findUnique({ where: { id } });
    if (!dist) throw new NotFoundException();
    if (input.businessName !== undefined || input.homeStoreId !== undefined) {
      await this.prisma.distributor.update({
        where: { id },
        data: {
          businessName: input.businessName,
          homeStoreId: input.homeStoreId,
        },
      });
    }
    if (input.name !== undefined || input.email !== undefined || input.phone !== undefined) {
      await this.prisma.user.update({
        where: { id: dist.userId },
        data: { name: input.name, email: input.email, phone: input.phone },
      });
    }
    return this.findById(id);
  }
}
