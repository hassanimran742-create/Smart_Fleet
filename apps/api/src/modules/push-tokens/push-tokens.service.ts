import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PushTokensService {
  constructor(private prisma: PrismaService) {}

  upsert(userId: string, token: string, platform?: string) {
    return this.prisma.expoPushToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  removeByToken(token: string) {
    return this.prisma.expoPushToken.deleteMany({ where: { token } });
  }

  forUser(userId: string) {
    return this.prisma.expoPushToken.findMany({ where: { userId } });
  }
}
