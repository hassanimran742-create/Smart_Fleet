import { Injectable } from '@nestjs/common';
import { DriverAvailability, Prisma, UserRole, UserStatus } from '@prisma/client';
import type { DriverOfficeDto, IsoDateTime } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import {
  parseRequest,
  updateDriverProfileSchema,
  type CreateDriverInput,
  type DriverAvailabilityInput,
  type DriverVehicleInput,
  type UpdateDriverProfileInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { toFieldErrors } from '../../common/pipes/zod-body.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SessionCheckService } from '../auth/session-check.service';
import { assertVansEmptyForDriverChange } from '../custody/van';
import { CnicVault } from '../users/cnic-vault.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The driver view (API_CONTRACT §3.5, §7.2): `DriverOfficeDto`, with the last known position for the
 * office map and the live-tracking dialog. Office views add `cnicMasked`; a driver reading themselves
 * gets the same shape without it. Never the password hash or the CNIC.
 */
export type DriverView = DriverOfficeDto;

/** Fields a driver may change on their own profile; anything else is office-only. */
const SELF_PROFILE_FIELDS: ReadonlySet<string> = new Set(['name', 'profilePictureUrl']);

const DRIVER_ROW_SELECT = {
  id: true,
  userId: true,
  licenceNo: true,
  availability: true,
  isOnline: true,
  currentVehicleId: true,
  currentZoneId: true,
  currentLocationUpdatedAt: true,
  leaveStart: true,
  leaveEnd: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      status: true,
      profilePictureUrl: true,
      // Read only to mask and compare them; never copied into a response.
      cnicEncrypted: true,
      cnicIndex: true,
      cnic: true,
    },
  },
  currentVehicle: { select: { id: true, plateNo: true } },
} satisfies Prisma.DriverSelect;

type DriverRow = Prisma.DriverGetPayload<{ select: typeof DRIVER_ROW_SELECT }>;

/** Who sees a driver view: the office (with `cnicMasked`) or the driver themselves. */
type Audience = 'office' | 'self';

interface LocationRow {
  id: string;
  lat: number | null;
  lng: number | null;
}

/** One online driver on the office map (`drivers:snapshot`). */
export interface DriverSnapshotRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  updated_at: Date | null;
}

function iso(date: Date | null): IsoDateTime | null {
  return date ? date.toISOString() : null;
}

/**
 * A blank `cnic` in a profile edit leaves the CNIC as it is; only `null` clears it. Responses never
 * carry the CNIC (API_CONTRACT §3.5), so a form that pre-fills its fields from a response (the legacy
 * website's driver dialog) sends "" for it, and that must not wipe the stored CNIC.
 */
function keepCnicOnBlank(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { cnic, ...rest } = body as Record<string, unknown>;
  return typeof cnic === 'string' && cnic.trim() === '' ? rest : body;
}

function phoneProblem(): AppError<'VALIDATION_FAILED'> {
  return new AppError('VALIDATION_FAILED', {
    fields: [{ path: 'phone', code: 'INVALID_PHONE', message: validationMessage('INVALID_PHONE') }],
  });
}

/**
 * Drivers (API_CONTRACT §7.2, §7.14). The office creates, edits, archives and reactivates them, gives
 * them vans and sets their availability; a driver reads their own profile, changes their name and
 * photo, and reports their own position and online state. Every office change is audited in its
 * transaction; archiving bumps the user's `tv`, so the driver's sessions end.
 */
@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly cnic: CnicVault,
    private readonly sessions: SessionCheckService,
  ) {}

  /** `GET /drivers` (office). */
  async listForOffice(): Promise<DriverView[]> {
    const rows = await this.prisma.driver.findMany({
      select: DRIVER_ROW_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.toViews(rows, 'office');
  }

  /** `GET /drivers/:id`: the office, or the driver reading themselves (another driver's id is 404). */
  async view(caller: AuthContext, id: string): Promise<DriverView> {
    const audience = this.audienceFor(caller, id);
    return this.viewOf(id, audience);
  }

  /**
   * `POST /drivers` (office). The phone is normalised (400 INVALID_PHONE) and must not belong to any
   * user (409 USER_PHONE_IN_USE, never an upsert); a used licence number is 409 CONFLICT_DUPLICATE; a
   * CNIC is stored encrypted and must be unique (409 USER_CNIC_IN_USE). Creates an ACTIVE DRIVER user
   * with no password and an AVAILABLE driver; audit `driver.create`.
   */
  async create(actor: UserActor, body: CreateDriverInput): Promise<DriverView> {
    const phone = normalizePkPhone(body.phone);
    if (!phone) throw phoneProblem();
    const sealed = body.cnic ? this.cnic.seal(body.cnic) : null;
    let driverId: string;
    try {
      driverId = await this.prisma.$transaction(async (tx) => {
        const holder = await tx.user.findUnique({ where: { phone }, select: { role: true } });
        if (holder) throw new AppError('USER_PHONE_IN_USE', { existingRole: holder.role });
        const licenceTaken = await tx.driver.findUnique({ where: { licenceNo: body.licenceNo }, select: { id: true } });
        if (licenceTaken) throw new AppError('CONFLICT_DUPLICATE');
        if (body.cnic) await this.cnic.assertFree(tx, body.cnic);
        if (body.email) await this.assertEmailFree(tx, body.email);

        const user = await tx.user.create({
          data: {
            phone,
            name: body.name,
            role: UserRole.DRIVER,
            status: UserStatus.ACTIVE,
            email: body.email ?? null,
            profilePictureUrl: body.profilePictureUrl ?? null,
            ...(sealed ?? {}),
          },
          select: { id: true },
        });
        const driver = await tx.driver.create({
          data: { userId: user.id, licenceNo: body.licenceNo, availability: DriverAvailability.AVAILABLE },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: 'driver.create',
            actor,
            resourceType: 'driver',
            resourceId: driver.id,
            after: {
              name: body.name,
              phone,
              licenceNo: body.licenceNo,
              email: body.email ?? null,
              cnicSet: sealed !== null,
            },
          },
          tx,
        );
        return driver.id;
      });
    } catch (error) {
      throw this.uniqueProblem(error, phone);
    }
    return this.viewOf(driverId, 'office');
  }

  /**
   * `PATCH /drivers/:id/profile`. The office: `{ name?, email?, cnic?, licenceNo?, profilePictureUrl? }`
   * (absent leaves a field unchanged; null clears email, cnic or the photo; a blank cnic is left
   * alone, see {@link keepCnicOnBlank}). A driver on themselves:
   * `name` and `profilePictureUrl` only; any other field is 403 USER_FIELD_OFFICE_ONLY and nothing
   * changes; another driver's id is 404. Audit `driver.update` with the changed fields before and after.
   */
  async updateProfile(caller: UserActor, id: string, rawBody: unknown): Promise<DriverView> {
    const audience = this.audienceFor(caller, id);
    if (audience === 'self' && rawBody && typeof rawBody === 'object') {
      if (Object.keys(rawBody).some((key) => !SELF_PROFILE_FIELDS.has(key))) throw new AppError('USER_FIELD_OFFICE_ONLY');
    }
    const parsed = parseRequest(updateDriverProfileSchema, keepCnicOnBlank(rawBody ?? {}));
    if (!parsed.success) throw new AppError(parsed.errorCode, { fields: toFieldErrors(parsed.fields) });
    const body: UpdateDriverProfileInput = parsed.data;

    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await this.lockDriver(tx, id);
        const userData: Prisma.UserUpdateInput = {};
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        const note = (field: string, from: unknown, to: unknown) => {
          before[field] = from;
          after[field] = to;
        };

        if (body.name !== undefined && body.name !== current.user.name) {
          userData.name = body.name;
          note('name', current.user.name, body.name);
        }
        if (body.profilePictureUrl !== undefined && body.profilePictureUrl !== current.user.profilePictureUrl) {
          userData.profilePictureUrl = body.profilePictureUrl;
          note('profilePictureUrl', current.user.profilePictureUrl, body.profilePictureUrl);
        }
        if (audience === 'office') {
          if (body.email !== undefined && body.email !== current.user.email) {
            if (body.email) await this.assertEmailFree(tx, body.email, current.userId);
            userData.email = body.email;
            note('email', current.user.email, body.email);
          }
          if (body.cnic !== undefined) {
            const sealed = body.cnic === null ? null : this.cnic.seal(body.cnic);
            const { cnicEncrypted, cnicIndex, cnic: legacyCnic } = current.user;
            const hadCnic = cnicIndex !== null || cnicEncrypted !== null || legacyCnic !== null;
            const unchanged = sealed ? sealed.cnicIndex === cnicIndex && legacyCnic === null : !hadCnic;
            if (!unchanged) {
              if (body.cnic) await this.cnic.assertFree(tx, body.cnic, current.userId);
              userData.cnicEncrypted = sealed ? sealed.cnicEncrypted : null;
              userData.cnicIndex = sealed ? sealed.cnicIndex : null;
              // A plain CNIC left from before Inc 1 is removed, never rewritten (API_CONTRACT §7.3 rule 4).
              if (legacyCnic !== null) userData.cnic = null;
              // The CNIC itself never goes into the audit row; only whether one is stored.
              note('cnicSet', hadCnic, sealed !== null);
            }
          }
          if (body.licenceNo !== undefined && body.licenceNo !== current.licenceNo) {
            const taken = await tx.driver.findFirst({ where: { licenceNo: body.licenceNo, id: { not: id } }, select: { id: true } });
            if (taken) throw new AppError('CONFLICT_DUPLICATE');
            await tx.driver.update({ where: { id }, data: { licenceNo: body.licenceNo } });
            note('licenceNo', current.licenceNo, body.licenceNo);
          }
        }

        if (Object.keys(userData).length > 0) await tx.user.update({ where: { id: current.userId }, data: userData });
        if (Object.keys(after).length > 0) {
          await this.audit.record(
            {
              action: 'driver.update',
              actor: caller,
              resourceType: 'driver',
              resourceId: id,
              diff: { name: body.name ?? current.user.name },
              before,
              after,
            },
            tx,
          );
        }
      });
    } catch (error) {
      throw this.uniqueProblem(error);
    }
    return this.viewOf(id, audience);
  }

  /** `PATCH /drivers/:id/location` (DRIVER exact, own id only; another id is 404). */
  async updateLocation(caller: AuthContext, id: string, lat: number, lng: number): Promise<{ ok: true; zoneId: string | null }> {
    this.assertSelf(caller, id);
    const zoneId = await this.applyLocation(id, lat, lng);
    return { ok: true, zoneId };
  }

  /** `PATCH /drivers/:id/online` (DRIVER exact, own id only; another id is 404). */
  async updateOnline(caller: AuthContext, id: string, isOnline: boolean): Promise<{ ok: true }> {
    this.assertSelf(caller, id);
    await this.applyOnline(id, isOnline);
    return { ok: true };
  }

  /**
   * Stores a driver's position and the active zone covering it (the §5.6 rule: active zones,
   * ST_Covers, smallest area, then oldest). Returns that zone, or null outside every active zone.
   */
  async applyLocation(driverId: string, lat: number, lng: number): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ zone_id: string | null }>>`
      UPDATE drivers
      SET current_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
          current_location_updated_at = now(),
          current_zone_id = (
            SELECT z.id FROM zones z
            WHERE z.is_active AND ST_Covers(z.polygon, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
            ORDER BY ST_Area(z.polygon), z.created_at, z.id
            LIMIT 1),
          updated_at = now()
      WHERE id = ${driverId}::uuid
      RETURNING current_zone_id AS zone_id`;
    if (rows.length === 0) throw new AppError('NOT_FOUND');
    return rows[0].zone_id;
  }

  /**
   * Going online opens a shift and going offline closes the open one (the attendance report reads
   * them). A driver who is on leave or off duty, or whose user isn't ACTIVE (archived or suspended,
   * even by a change that raced an early `online:set`), can't go online (409 ASSIGN_DRIVER_NOT_AVAILABLE).
   */
  async applyOnline(driverId: string, isOnline: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // The same row lock as the office's changes (archive, availability), so a racing one is seen.
      await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${driverId}::uuid FOR UPDATE`;
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        select: { availability: true, isOnline: true, user: { select: { name: true, status: true } } },
      });
      if (!driver) throw new AppError('NOT_FOUND');
      if (isOnline && (driver.availability !== DriverAvailability.AVAILABLE || driver.user.status !== UserStatus.ACTIVE)) {
        throw new AppError('ASSIGN_DRIVER_NOT_AVAILABLE', { driver: driver.user.name });
      }
      await tx.driver.update({ where: { id: driverId }, data: { isOnline } });
      const now = new Date();
      // Close any shift still open: a new one starts below when going online.
      await tx.driverShift.updateMany({ where: { driverId, endedAt: null }, data: { endedAt: now } });
      if (isOnline) await tx.driverShift.create({ data: { driverId } });
    });
  }

  /** A driver's name, for the office's live map; null for an unknown id. */
  async nameOf(driverId: string): Promise<string | null> {
    const row = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { user: { select: { name: true } } } });
    return row?.user.name ?? null;
  }

  /** The online drivers with a known position, for the office's `drivers:snapshot`. */
  async liveSnapshot(): Promise<DriverSnapshotRow[]> {
    return this.prisma.$queryRaw<DriverSnapshotRow[]>`
      SELECT d.id, u.name,
             ST_Y(d.current_location) AS lat,
             ST_X(d.current_location) AS lng,
             d.current_location_updated_at AS updated_at
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      WHERE d.current_location IS NOT NULL AND d.is_online = TRUE AND u.status = 'ACTIVE'
      ORDER BY u.name, d.id`;
  }

  /**
   * `PATCH /drivers/:id/vehicle` (office) `{ vehicleId }`: gives the driver a van (taking it from
   * whoever had it) or, with null, takes theirs away. Each driver whose van changes gets a
   * `driver.update` row. Giving the van they already have is 200 with X-Already-Applied.
   *
   * From Inc 2 (API_CONTRACT §9.5): while the driver's current van or the new one holds any cylinder,
   * the change is refused with 409 `VEHICLE_HAS_CYLINDERS` `{count}` and nothing is written; the store
   * scans them in first, so every cylinder keeps one responsible driver.
   */
  async assignVehicle(actor: UserActor, id: string, body: DriverVehicleInput): Promise<DriverView | IdempotentResponse<DriverView>> {
    const vehicleId = body.vehicleId;
    const changed = await this.prisma.$transaction(async (tx) => {
      if (vehicleId) {
        const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
        if (!vehicle) throw new AppError('NOT_FOUND', { field: 'vehicleId' });
      }
      const current = await this.lockDriver(tx, id);
      if (current.currentVehicleId === vehicleId) return false;
      await assertVansEmptyForDriverChange(tx, [current.currentVehicleId, vehicleId]);
      if (vehicleId) {
        const previous = await tx.driver.findFirst({
          where: { currentVehicleId: vehicleId, id: { not: id } },
          select: { id: true, user: { select: { name: true } } },
        });
        if (previous) {
          await tx.driver.update({ where: { id: previous.id }, data: { currentVehicleId: null } });
          await this.audit.record(
            {
              action: 'driver.update',
              actor,
              resourceType: 'driver',
              resourceId: previous.id,
              diff: { name: previous.user.name },
              before: { currentVehicleId: vehicleId },
              after: { currentVehicleId: null },
            },
            tx,
          );
        }
      }
      await tx.driver.update({ where: { id }, data: { currentVehicleId: vehicleId } });
      await this.audit.record(
        {
          action: 'driver.update',
          actor,
          resourceType: 'driver',
          resourceId: id,
          diff: { name: current.user.name },
          before: { currentVehicleId: current.currentVehicleId },
          after: { currentVehicleId: vehicleId },
        },
        tx,
      );
      return true;
    });
    const view = await this.viewOf(id, 'office');
    return changed ? view : alreadyApplied(view);
  }

  /**
   * `PATCH /drivers/:id/availability` (office). On leave or off duty, the driver goes offline and the
   * open shift closes; back to available, the leave dates clear. Audited as `driver.update`.
   */
  async setAvailability(actor: UserActor, id: string, body: DriverAvailabilityInput): Promise<DriverView> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDriver(tx, id);
      const onLeave = body.availability === DriverAvailability.ON_LEAVE;
      const data: Prisma.DriverUpdateInput = {
        availability: body.availability,
        leaveStart: onLeave && body.leaveStart ? new Date(body.leaveStart) : null,
        leaveEnd: onLeave && body.leaveEnd ? new Date(body.leaveEnd) : null,
        leaveReason: onLeave ? body.reason ?? null : null,
      };
      if (body.availability !== DriverAvailability.AVAILABLE) {
        data.isOnline = false;
        await tx.driverShift.updateMany({ where: { driverId: id, endedAt: null }, data: { endedAt: new Date() } });
      }
      await tx.driver.update({ where: { id }, data });
      await this.audit.record(
        {
          action: 'driver.update',
          actor,
          resourceType: 'driver',
          resourceId: id,
          diff: { name: current.user.name },
          before: { availability: current.availability, leaveStart: current.leaveStart, leaveEnd: current.leaveEnd },
          after: { availability: body.availability, leaveStart: data.leaveStart ?? null, leaveEnd: data.leaveEnd ?? null },
        },
        tx,
      );
    });
    return this.viewOf(id, 'office');
  }

  /**
   * `DELETE /drivers/:id` (office) `{ reason }`: the user is SUSPENDED, the van released, the driver
   * offline and `tv` bumped, so their sessions end; sign-in then answers AUTH_ACCOUNT_NOT_ACTIVE and
   * assignment ASSIGN_DRIVER_NOT_AVAILABLE. Audit `driver.archive`. A repeat is 200 X-Already-Applied.
   */
  async archive(actor: UserActor, id: string, reason: string): Promise<DriverView | IdempotentResponse<DriverView>> {
    let userId = '';
    const changed = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDriver(tx, id);
      userId = current.userId;
      if (current.user.status === UserStatus.SUSPENDED && current.currentVehicleId === null && !current.isOnline) return false;
      await tx.driver.update({ where: { id }, data: { currentVehicleId: null, isOnline: false } });
      await tx.driverShift.updateMany({ where: { driverId: id, endedAt: null }, data: { endedAt: new Date() } });
      await tx.user.update({
        where: { id: current.userId },
        data: { status: UserStatus.SUSPENDED, tokenVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: 'driver.archive',
          actor,
          resourceType: 'driver',
          resourceId: id,
          reason,
          diff: { name: current.user.name },
          before: { status: current.user.status, currentVehicleId: current.currentVehicleId, isOnline: current.isOnline },
          after: { status: UserStatus.SUSPENDED, currentVehicleId: null, isOnline: false },
        },
        tx,
      );
      return true;
    });
    this.sessions.forget(userId);
    const view = await this.viewOf(id, 'office');
    return changed ? view : alreadyApplied(view);
  }

  /**
   * `PATCH /drivers/:id/reactivate` (office) `{ reason }`: the user becomes ACTIVE again; the van is
   * not given back. Audit `driver.reactivate`. A repeat is 200 X-Already-Applied.
   */
  async reactivate(actor: UserActor, id: string, reason: string): Promise<DriverView | IdempotentResponse<DriverView>> {
    let userId = '';
    const changed = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDriver(tx, id);
      userId = current.userId;
      if (current.user.status === UserStatus.ACTIVE) return false;
      await tx.user.update({ where: { id: current.userId }, data: { status: UserStatus.ACTIVE } });
      await this.audit.record(
        {
          action: 'driver.reactivate',
          actor,
          resourceType: 'driver',
          resourceId: id,
          reason,
          diff: { name: current.user.name },
          before: { status: current.user.status },
          after: { status: UserStatus.ACTIVE },
        },
        tx,
      );
      return true;
    });
    this.sessions.forget(userId);
    const view = await this.viewOf(id, 'office');
    return changed ? view : alreadyApplied(view);
  }

  // ---------- internals ----------

  /** Office for SUPER_ADMIN; for a DRIVER only their own id (anything else is 404, §3.2). */
  private audienceFor(caller: Pick<AuthContext, 'role' | 'driverId'>, id: string): Audience {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    if (caller.role === UserRole.SUPER_ADMIN) return 'office';
    if (caller.role === UserRole.DRIVER && caller.driverId === id) return 'self';
    throw new AppError('NOT_FOUND');
  }

  private assertSelf(caller: Pick<AuthContext, 'role' | 'driverId'>, id: string): void {
    if (!(caller.role === UserRole.DRIVER && caller.driverId === id)) throw new AppError('NOT_FOUND');
  }

  /** Locks a driver row for an office change, then reads it. 404 for an unknown id. */
  private async lockDriver(tx: Prisma.TransactionClient, id: string): Promise<DriverRow> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.driver.findUnique({ where: { id }, select: DRIVER_ROW_SELECT });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  /** 409 CONFLICT_DUPLICATE when another account uses the email. */
  private async assertEmailFree(tx: Prisma.TransactionClient, email: string, exceptUserId?: string): Promise<void> {
    const holder = await tx.user.findFirst({
      where: { email, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
      select: { id: true },
    });
    if (holder) throw new AppError('CONFLICT_DUPLICATE');
  }

  /** Unique keys hit by a race after the checks above: the same answers the checks give. */
  private uniqueProblem(error: unknown, phone?: string): unknown {
    if (error instanceof AppError) return error;
    if (isUniqueViolation(error, 'users_phone_key')) return phone ? new AppError('USER_PHONE_IN_USE') : error;
    if (isUniqueViolation(error, 'users_email_key') || isUniqueViolation(error, 'drivers_licence_no_key')) {
      return new AppError('CONFLICT_DUPLICATE');
    }
    return error;
  }

  private async viewOf(id: string, audience: Audience): Promise<DriverView> {
    const row = await this.prisma.driver.findUnique({ where: { id }, select: DRIVER_ROW_SELECT });
    if (!row) throw new AppError('NOT_FOUND');
    const [view] = await this.toViews([row], audience);
    return view;
  }

  private async toViews(rows: DriverRow[], audience: Audience): Promise<DriverView[]> {
    const ids = rows.map((row) => row.id);
    const locations = ids.length
      ? await this.prisma.$queryRaw<LocationRow[]>`
          SELECT id, ST_Y(current_location) AS lat, ST_X(current_location) AS lng
          FROM drivers WHERE id = ANY(${ids}::uuid[]) AND current_location IS NOT NULL`
      : [];
    const byId = new Map(locations.map((row) => [row.id, row]));
    return rows.map((row) => {
      const at = byId.get(row.id);
      const view: DriverView = {
        id: row.id,
        userId: row.userId,
        licenceNo: row.licenceNo,
        availability: row.availability,
        isOnline: row.isOnline,
        currentVehicleId: row.currentVehicleId,
        currentZoneId: row.currentZoneId,
        leaveStart: iso(row.leaveStart),
        leaveEnd: iso(row.leaveEnd),
        user: {
          id: row.user.id,
          name: row.user.name,
          phone: row.user.phone,
          email: row.user.email,
          status: row.user.status,
          profilePictureUrl: row.user.profilePictureUrl,
        },
        currentVehicle: row.currentVehicle ? { id: row.currentVehicle.id, plateNo: row.currentVehicle.plateNo } : null,
        createdAt: row.createdAt.toISOString(),
        currentLocation: at && at.lat !== null && at.lng !== null ? { lat: Number(at.lat), lng: Number(at.lng) } : null,
        currentLocationUpdatedAt: iso(row.currentLocationUpdatedAt),
      };
      if (audience === 'office') view.cnicMasked = this.cnic.maskOf(row.user);
      return view;
    });
  }
}
