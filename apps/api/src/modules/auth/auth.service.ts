import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { OtpPurpose, UserRole, UserStatus } from '@prisma/client';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_WINDOW_MS = 60 * 1000;
const OTP_RATE_MAX = 3;

@Injectable()
export class AuthService {
  private logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private sms: SmsService,
    private jwt: JwtService,
    private cfg: ConfigService,
  ) {}

  async sendOtp(phone: string, purpose: OtpPurpose) {
    const since = new Date(Date.now() - OTP_RATE_WINDOW_MS);
    const recent = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gte: since } },
    });
    if (recent >= OTP_RATE_MAX) {
      throw new BadRequestException('Too many OTP requests, please wait.');
    }

    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = await argon2.hash(code);
    await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await this.sms.sendOtp(phone, code);
    return { ok: true };
  }

  async verifyOtp(phone: string, code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('OTP expired or not found');

    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts');
    }

    const ok = await argon2.verify(otp.codeHash, code);
    if (!ok) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid code');
    }
    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    let user = await this.prisma.user.findUnique({
      where: { phone },
      include: { distributorProfile: true, driverProfile: true },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: { phone, name: phone, role: UserRole.CLIENT, status: UserStatus.ACTIVE },
        include: { distributorProfile: true, driverProfile: true },
      });
    }

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.cfg.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt) {
      // Reuse detection: revoke entire chain
      if (stored?.userId) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { distributorProfile: true, driverProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    return this.issueTokens(user, stored.id);
  }

  private async issueTokens(user: any, parentRefreshId?: string) {
    const claims = {
      sub: user.id,
      role: user.role,
      distributorId: user.distributorProfile?.id,
      driverId: user.driverProfile?.id,
    };
    const accessTtl = this.cfg.get<number>('jwt.accessTtl') ?? 900;
    const refreshTtl = this.cfg.get<number>('jwt.refreshTtl') ?? 2_592_000;

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.cfg.get<string>('jwt.accessSecret'),
      expiresIn: accessTtl,
    });
    const refreshToken = await this.jwt.signAsync(claims, {
      secret: this.cfg.get<string>('jwt.refreshSecret'),
      expiresIn: refreshTtl,
    });
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        parentId: parentRefreshId,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken, expiresIn: accessTtl, role: user.role };
  }
}
