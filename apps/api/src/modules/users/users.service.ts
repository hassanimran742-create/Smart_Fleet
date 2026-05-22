import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list(role?: UserRole) {
    return this.prisma.user.findMany({
      where: role ? { role } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { distributorProfile: true, driverProfile: true },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  updateProfile(
    userId: string,
    input: { name?: string; email?: string; phone?: string; cnic?: string; businessName?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.email !== undefined || input.phone !== undefined || input.cnic !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            name: input.name,
            email: input.email,
            phone: input.phone,
            cnic: input.cnic,
          },
        });
      }
      if (input.businessName !== undefined) {
        await tx.distributor.updateMany({
          where: { userId },
          data: { businessName: input.businessName },
        });
      }
      return tx.user.findUnique({
        where: { id: userId },
        include: { distributorProfile: true, driverProfile: true },
      });
    });
  }

  setStatus(id: string, status: UserStatus) {
    return this.prisma.user.update({ where: { id }, data: { status } });
  }

  setRole(id: string, role: UserRole) {
    return this.prisma.user.update({ where: { id }, data: { role } });
  }
}
