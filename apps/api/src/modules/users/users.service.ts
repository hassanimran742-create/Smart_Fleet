import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** Strip the password hash from any user object before returning to clients. */
  private safe<T extends { passwordHash?: string | null } | null | undefined>(u: T): T {
    if (!u) return u;
    const { passwordHash: _omit, ...rest } = u as any;
    return { ...(rest as any), hasPassword: !!_omit };
  }

  async list(role?: UserRole) {
    const rows = await this.prisma.user.findMany({
      where: role ? { role } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.safe(r));
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        distributorProfile: true,
        driverProfile: { include: { currentVehicle: true } },
      },
    });
    if (!user) throw new NotFoundException();
    return this.safe(user);
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
      const fresh = await tx.user.findUnique({
        where: { id: userId },
        include: {
          distributorProfile: true,
          driverProfile: { include: { currentVehicle: true } },
        },
      });
      return this.safe(fresh);
    });
  }

  async setStatus(id: string, status: UserStatus) {
    const u = await this.prisma.user.update({ where: { id }, data: { status } });
    return this.safe(u);
  }

  async setRole(id: string, role: UserRole) {
    const u = await this.prisma.user.update({ where: { id }, data: { role } });
    return this.safe(u);
  }

  async resetPassword(id: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    if (user.role === UserRole.CLIENT) {
      throw new BadRequestException(
        'CLIENT users authenticate via OTP and do not have passwords.',
      );
    }
    const passwordHash = await argon2.hash(password);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
    return { ok: true };
  }
}
