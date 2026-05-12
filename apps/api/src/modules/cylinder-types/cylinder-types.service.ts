import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CylinderTypesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.cylinderType.findMany({ orderBy: { name: 'asc' } });
  }

  create(input: { code: string; name: string; weightKg: number; capacityUnits: number }) {
    return this.prisma.cylinderType.create({ data: input });
  }
}
