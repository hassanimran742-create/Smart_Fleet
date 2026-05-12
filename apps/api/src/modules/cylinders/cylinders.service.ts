import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustodyType } from '@prisma/client';

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

  bulkRegister(input: {
    distributorId: string;
    cylinderTypeId: string;
    serials: string[];
    initialCustodyType: CustodyType;
    initialCustodyId: string;
  }) {
    return this.prisma.$transaction(
      input.serials.map((serial) =>
        this.prisma.cylinder.create({
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
      ),
    );
  }
}
