import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AccessTokenVerifier } from './access-token.verifier';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionCheckService } from './session-check.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Sign-in and sessions (API_CONTRACT §3.3, §7.1). Registers the global guards in this order: the JWT
 * guard (401), then the roles guard (403), so roles are always checked on a known caller.
 * Exports the session check (other modules call `forget(userId)` after ending a user's sessions) and
 * the access-token verifier used by the `/drivers` socket.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.accessSecret'),
        signOptions: { expiresIn: cfg.get<number>('jwt.accessTtl') ?? 12 * 60 * 60 },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SessionCheckService,
    AccessTokenVerifier,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, SessionCheckService, AccessTokenVerifier],
})
export class AuthModule {}
