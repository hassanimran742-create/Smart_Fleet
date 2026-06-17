import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { RefreshDto, VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginPasswordDto } from './dto/login-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthContext } from '../../common/decorators/current-user.decorator';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  @Public()
  @Post('otp/send')
  send(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto.phone, dto.purpose as OtpPurpose);
  }

  @Public()
  @Post('otp/verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  // Password login — only available for admin-side roles.
  // Field roles (driver/distributor/client) must use OTP.
  @Public()
  @Post('login')
  loginPassword(@Body() dto: LoginPasswordDto) {
    return this.auth.loginWithPassword(dto.phone, dto.password);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // Useful for the client to confirm what role / claims are in its token.
  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, phone: true, email: true, name: true, role: true, status: true },
    });
  }
}
