import { Injectable, NotFoundException } from '@nestjs/common';
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
    homeStoreId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone: input.phone },
        update: { name: input.name, role: UserRole.DISTRIBUTOR },
        create: {
          phone: input.phone,
          name: input.name,
          role: UserRole.DISTRIBUTOR,
          status: UserStatus.PENDING,
        },
      });
      return tx.distributor.create({
        data: {
          userId: user.id,
          businessName: input.businessName,
          homeStoreId: input.homeStoreId,
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
}
