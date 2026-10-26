import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Expo push tokens (API_CONTRACT §7.2). One phone has one signed-in user: registering a token moves
 * it to the caller. A user removes only their own token, and the answer never says whose a token was.
 */
@Injectable()
export class PushTokensService {
  constructor(private prisma: PrismaService) {}

  /** `POST /push-tokens`: upserts by token; a token another user held now belongs to the caller. */
  async register(userId: string, token: string, platform?: string): Promise<{ ok: true }> {
    await this.prisma.expoPushToken.upsert({
      where: { token },
      update: { userId, platform: platform ?? null },
      create: { userId, token, platform: platform ?? null },
    });
    return { ok: true };
  }

  /** `DELETE /push-tokens`: deletes the row only when it is the caller's; `removed` is 0 or 1. */
  async remove(userId: string, token: string): Promise<{ removed: number }> {
    const { count } = await this.prisma.expoPushToken.deleteMany({ where: { token, userId } });
    return { removed: count };
  }

  forUser(userId: string) {
    return this.prisma.expoPushToken.findMany({ where: { userId } });
  }
}
