import { Injectable } from '@nestjs/common';
import { DistributorStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import type { SafeUserDto } from '@smartfleet/shared-types';
import { parseRequest, updateMeSchema, type SetUserRoleInput, type SetUserStatusInput } from '@smartfleet/shared-validation';
import * as argon2 from 'argon2';
import type { UserActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { toFieldErrors } from '../../common/pipes/zod-body.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SessionCheckService } from '../auth/session-check.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A user as any response may show it (API_CONTRACT §3.5): explicit fields only, never the password
 * hash, the CNIC in any form or the token version. `hasPassword` says whether the office has set an
 * app password. The profile parts are what the installed apps read (side menu, profile, vehicle).
 */
const SAFE_USER_SELECT = {
  id: true,
  phone: true,
  email: true,
  name: true,
  role: true,
  status: true,
  profilePictureUrl: true,
  createdAt: true,
  updatedAt: true,
  passwordHash: true,
  distributorProfile: { select: { id: true, businessName: true, code: true, status: true, homeStoreId: true } },
  driverProfile: {
    select: {
      id: true,
      licenceNo: true,
      availability: true,
      isOnline: true,
      currentVehicleId: true,
      currentVehicle: { select: { id: true, plateNo: true, capacityUnits: true, status: true, currentOdometerKm: true } },
    },
  },
} satisfies Prisma.UserSelect;

type SafeUserRow = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

export type { SafeUserDto };

/** The row as the shared `SafeUserDto` (shared-types, README rule 2): every field named, dates as ISO text. */
function toSafeUser(row: SafeUserRow): SafeUserDto {
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    profilePictureUrl: row.profilePictureUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasPassword: row.passwordHash !== null,
    distributorProfile: row.distributorProfile,
    driverProfile: row.driverProfile,
  };
}

/** `PATCH /users/me` fields only the office may change (API_CONTRACT §7.2). */
const OFFICE_ONLY_FIELDS = ['phone', 'cnic', 'businessName'] as const;

/** The office sets app passwords for these logins only (§7.2 `POST /users/:id/password`). */
const PASSWORD_RESET_ROLES: readonly UserRole[] = [UserRole.DISTRIBUTOR, UserRole.DRIVER];

/** Roles a user without a shop, driver or customer profile may hold (a role must match the profile). */
const STAFF_ROLES: readonly UserRole[] = [UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER];

interface TargetRow {
  id: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  distributorProfile: { id: string } | null;
  driverProfile: { id: string } | null;
  clientProfile: { id: string } | null;
}

const TARGET_SELECT = {
  id: true,
  name: true,
  role: true,
  status: true,
  distributorProfile: { select: { id: true } },
  driverProfile: { select: { id: true } },
  clientProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

/** The roles a user may be given, from the profile it has. */
function rolesAllowedFor(target: TargetRow): readonly UserRole[] {
  if (target.distributorProfile) return [UserRole.DISTRIBUTOR];
  if (target.driverProfile) return [UserRole.DRIVER];
  if (target.clientProfile) return [UserRole.CLIENT];
  return STAFF_ROLES;
}

/**
 * A DISTRIBUTOR without its shop row or a DRIVER without its driver row: legacy data that can't sign
 * in (API_CONTRACT §3.2), so the office can neither give it a password nor make it ACTIVE.
 */
function lacksOwnProfile(target: TargetRow): boolean {
  if (target.role === UserRole.DISTRIBUTOR) return target.distributorProfile === null;
  if (target.role === UserRole.DRIVER) return target.driverProfile === null;
  return false;
}

/**
 * Users and the office's account controls (API_CONTRACT §3.3, §7.2). Status, role and password
 * changes bump `token_version`, so the user's sessions end, and write their audit row in the same
 * transaction.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly sessions: SessionCheckService,
  ) {}

  /** `GET /users` (office). */
  async list(role?: UserRole): Promise<SafeUserDto[]> {
    const rows = await this.prisma.user.findMany({
      where: role ? { role } : undefined,
      select: SAFE_USER_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return rows.map(toSafeUser);
  }

  /** `GET /users/me` and `GET /users/:id` (office). */
  async profile(id: string): Promise<SafeUserDto> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const row = await this.prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT });
    if (!row) throw new AppError('NOT_FOUND');
    return toSafeUser(row);
  }

  /**
   * `PATCH /users/me`: only `name` and `email`. A body naming `phone`, `cnic` or `businessName` at
   * all, even unchanged, is refused whole with 403 USER_FIELD_OFFICE_ONLY; other unknown keys are
   * ignored. An email another account uses is 409 CONFLICT_DUPLICATE.
   */
  async updateMe(userId: string, rawBody: unknown): Promise<SafeUserDto> {
    if (rawBody && typeof rawBody === 'object' && OFFICE_ONLY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(rawBody, field))) {
      throw new AppError('USER_FIELD_OFFICE_ONLY');
    }
    const parsed = parseRequest(updateMeSchema, rawBody ?? {});
    if (!parsed.success) throw new AppError(parsed.errorCode, { fields: toFieldErrors(parsed.fields) });
    const body = parsed.data;

    const data: Prisma.UserUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email;
    if (Object.keys(data).length > 0) {
      try {
        await this.prisma.user.update({ where: { id: userId }, data });
      } catch (error) {
        if (isUniqueViolation(error, 'users_email_key')) throw new AppError('CONFLICT_DUPLICATE');
        throw error;
      }
    }
    return this.profile(userId);
  }

  /**
   * `PATCH /users/:id/status` (office) `{ value, reason }`. Not on oneself; a super admin target locks
   * every active super admin first (by id) and re-reads the caller, so two office users suspending
   * each other at once end with one 200 and one 401; the last active super admin stays. A DISTRIBUTOR
   * or DRIVER user without its shop or driver row can't be made ACTIVE (403 PERMISSION_DENIED; the
   * role must match the profile). For a distributor's user, `distributors.status` changes in the same
   * transaction. A repeat is 200 with X-Already-Applied and changes nothing.
   */
  async setStatus(
    actor: UserActor,
    id: string,
    body: SetUserStatusInput,
  ): Promise<SafeUserDto | IdempotentResponse<SafeUserDto>> {
    const value = body.value as UserStatus;
    const changed = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockTarget(tx, actor, id, (row) => {
        if (value === UserStatus.ACTIVE && lacksOwnProfile(row)) throw new AppError('PERMISSION_DENIED');
      });
      if (target.status === value) return false;
      if (target.role === UserRole.SUPER_ADMIN && target.status === UserStatus.ACTIVE) {
        await this.assertAnotherActiveSuperAdmin(tx, target.id);
      }
      const updated = await tx.user.updateMany({
        where: { id: target.id, status: target.status },
        data: { status: value, tokenVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      if (target.distributorProfile) {
        // A distributor's two status columns always change together (API_CONTRACT §7.3).
        await tx.distributor.update({ where: { id: target.distributorProfile.id }, data: { status: value as DistributorStatus } });
      }
      await this.audit.record(
        {
          action: 'user.status_change',
          actor,
          resourceType: 'user',
          resourceId: target.id,
          distributorId: target.distributorProfile?.id ?? null,
          reason: body.reason,
          diff: { name: target.name },
          before: { status: target.status },
          after: { status: value },
        },
        tx,
      );
      return true;
    });
    this.sessions.forget(id);
    const user = await this.profile(id);
    return changed ? user : alreadyApplied(user);
  }

  /**
   * `PATCH /users/:id/role` (office) `{ value, reason }`. Not on oneself, never to SUPER_ADMIN, and
   * the role must match the user's profile (a shop's user stays DISTRIBUTOR, a driver's DRIVER):
   * otherwise 403 USER_ROLE_CHANGE_NOT_ALLOWED. The last active super admin stays.
   */
  async setRole(
    actor: UserActor,
    id: string,
    body: SetUserRoleInput,
  ): Promise<SafeUserDto | IdempotentResponse<SafeUserDto>> {
    const value = body.value as UserRole;
    const changed = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockTarget(tx, actor, id, (row) => {
        if (value === UserRole.SUPER_ADMIN || (row.role !== value && !rolesAllowedFor(row).includes(value))) {
          throw new AppError('USER_ROLE_CHANGE_NOT_ALLOWED');
        }
      });
      if (target.role === value) return false;
      if (target.role === UserRole.SUPER_ADMIN && target.status === UserStatus.ACTIVE) {
        await this.assertAnotherActiveSuperAdmin(tx, target.id);
      }
      const updated = await tx.user.updateMany({
        where: { id: target.id, role: target.role },
        data: { role: value, tokenVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      await this.audit.record(
        {
          action: 'user.role_change',
          actor,
          resourceType: 'user',
          resourceId: target.id,
          distributorId: target.distributorProfile?.id ?? null,
          reason: body.reason,
          diff: { name: target.name },
          before: { role: target.role },
          after: { role: value },
        },
        tx,
      );
      return true;
    });
    this.sessions.forget(id);
    const user = await this.profile(id);
    return changed ? user : alreadyApplied(user);
  }

  /**
   * `POST /users/:id/password` (office) `{ password }`: the app password of a distributor or driver
   * login with its shop or driver row, whatever its status. The caller's own account is 403
   * USER_SELF_CHANGE_NOT_ALLOWED (office users use `POST /auth/change-password`); any other target,
   * a DISTRIBUTOR or DRIVER user without its row included, is 403 PERMISSION_DENIED. Bumps the
   * target's `tv`, so its sessions end. The audit row never holds the password or its hash.
   */
  async resetPassword(actor: UserActor, id: string, password: string): Promise<{ ok: true }> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const target = await this.prisma.user.findUnique({ where: { id }, select: TARGET_SELECT });
    if (!target) throw new AppError('NOT_FOUND');
    if (target.id === actor.userId) throw new AppError('USER_SELF_CHANGE_NOT_ALLOWED');
    if (!PASSWORD_RESET_ROLES.includes(target.role) || lacksOwnProfile(target)) throw new AppError('PERMISSION_DENIED');

    const passwordHash = await argon2.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id, role: { in: [...PASSWORD_RESET_ROLES] } },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      await this.audit.record(
        {
          action: 'user.password_reset',
          actor,
          resourceType: 'user',
          resourceId: id,
          distributorId: target.distributorProfile?.id ?? null,
          diff: { name: target.name, role: target.role },
        },
        tx,
      );
    });
    this.sessions.forget(id);
    return { ok: true };
  }

  /**
   * Reads and locks the target of a status or role change, after the checks every such change makes:
   * 404 for an unknown id, 403 USER_SELF_CHANGE_NOT_ALLOWED on oneself, then `precheck` (role rules).
   * A super admin target first locks every ACTIVE super admin row, ordered by id, so two office users
   * changing each other serialise; then the caller is re-read from the database, uncached, and a
   * caller no longer an active super admin gets 401 AUTH_SESSION_REVOKED.
   */
  private async lockTarget(
    tx: Prisma.TransactionClient,
    actor: UserActor,
    id: string,
    precheck?: (target: TargetRow) => void,
  ): Promise<TargetRow> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const first = await tx.user.findUnique({ where: { id }, select: TARGET_SELECT });
    if (!first) throw new AppError('NOT_FOUND');
    if (first.id === actor.userId) throw new AppError('USER_SELF_CHANGE_NOT_ALLOWED');
    precheck?.(first);

    if (first.role === UserRole.SUPER_ADMIN) {
      await tx.$queryRaw`
        SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
    }
    const caller = await tx.user.findUnique({ where: { id: actor.userId }, select: { role: true, status: true } });
    if (!caller || caller.status !== UserStatus.ACTIVE || caller.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('AUTH_SESSION_REVOKED');
    }
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id }, select: TARGET_SELECT });
    if (!target) throw new AppError('NOT_FOUND');
    precheck?.(target);
    return target;
  }

  /** 409 USER_LAST_SUPER_ADMIN when removing `targetId` would leave no active super admin. */
  private async assertAnotherActiveSuperAdmin(tx: Prisma.TransactionClient, targetId: string): Promise<void> {
    const others = await tx.user.count({
      where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE, id: { not: targetId } },
    });
    if (others < 1) throw new AppError('USER_LAST_SUPER_ADMIN');
  }
}
