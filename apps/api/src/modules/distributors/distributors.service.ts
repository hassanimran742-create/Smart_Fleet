import { Injectable } from '@nestjs/common';
import { DistributorStatus, UserRole, UserStatus } from '@prisma/client';
import { ORDER_LIST_TAB_STATUSES, type DistributorDto, type DistributorHomeDto } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import type {
  ApproveDistributorInput,
  CreateDistributorInput,
  UpdateDistributorInput,
  UpdateDistributorStoreInput,
} from '@smartfleet/shared-validation';
import { AppSeenService } from '../../common/app-seen/app-seen.service';
import type { Actor } from '../../common/auth/actor';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { alreadyApplied, assertSameRequest, replayed, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { maskCnic } from '../../common/security/cnic';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SessionCheckService } from '../auth/session-check.service';
import { currentBusinessDays } from '../orders/support/business-day';
import { LOCKING_TX, type Db, type Tx } from '../orders/support/tx';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { StoresService, type StoreSnapshot } from '../stores/stores.service';
import { WalletService } from '../wallet/wallet.service';
import { ZonesService } from '../zones/zones.service';
import { codeCandidates } from './distributor-code';

/**
 * Who reads a distributor: the office sees readiness, the masked CNIC and `app`, the shop app the distributor
 * last used (API_CONTRACT §1.4 `AppStatus`); the shop sees none of them.
 */
export type DistributorView = 'OFFICE' | 'SELF';

/** What `distributor.update` records before and after (Appendix B). */
interface ContactSnapshot {
  businessName: string;
  name: string;
  email: string | null;
  phone: string;
}

const DISTRIBUTOR_SELECT = {
  id: true,
  code: true,
  businessName: true,
  status: true,
  homeStoreId: true,
  user: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      passwordHash: true,
      cnicEncrypted: true,
      cnic: true,
      // The shop app the distributor last used (office views: "App: up to date", API_CONTRACT §8.5 step 10).
      appVariant: true,
      appVersion: true,
      appSeenAt: true,
    },
  },
  homeStore: { select: { id: true, name: true, address: true, zone: { select: { id: true, name: true } } } },
} as const;

function invalidPhone(): AppError<'VALIDATION_FAILED'> {
  return new AppError('VALIDATION_FAILED', {
    fields: [{ path: 'phone', code: 'INVALID_PHONE', message: validationMessage('INVALID_PHONE') }],
  });
}

function reasonRequired(): AppError<'VALIDATION_FAILED'> {
  return new AppError('VALIDATION_FAILED', {
    fields: [{ path: 'reason', code: 'REQUIRED', message: validationMessage('REQUIRED') }],
  });
}

/**
 * Distributors and their one store (API_CONTRACT §7.3, ADR-01, ADR-22). A distributor's two status
 * columns (`distributors.status`, `users.status`) always change together, in one transaction with
 * the audit row. The balance is read through WalletService; nothing here writes money.
 */
@Injectable()
export class DistributorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly zones: ZonesService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly audit: AuditLogService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly sessions: SessionCheckService,
    private readonly appSeen: AppSeenService,
  ) {}

  // ---------- reads ----------

  async list(): Promise<DistributorDto[]> {
    const rows = await this.prisma.distributor.findMany({ select: { id: true }, orderBy: [{ businessName: 'asc' }, { id: 'asc' }] });
    return this.dtos(
      rows.map((row) => row.id),
      'OFFICE',
    );
  }

  async byId(id: string, view: DistributorView = 'OFFICE'): Promise<DistributorDto> {
    const [dto] = await this.dtos([id], view);
    if (!dto) throw new AppError('NOT_FOUND');
    return dto;
  }

  /** `GET /distributor/home` (DISTRIBUTOR exact): the home screen in one round trip. */
  async home(distributorId: string): Promise<DistributorHomeDto> {
    const distributor = await this.prisma.distributor.findUnique({
      where: { id: distributorId },
      select: { businessName: true, code: true, status: true, homeStoreId: true },
    });
    if (!distributor) throw new AppError('NOT_FOUND');
    const today = await currentBusinessDays(this.settings);
    const open = [...ORDER_LIST_TAB_STATUSES.active];
    const [wallet, active, onTheWay, deliveredToday] = await Promise.all([
      this.wallet.summary(distributorId),
      this.prisma.order.count({ where: { distributorId, status: { in: open } } }),
      this.prisma.order.count({
        where: { distributorId, status: { in: open }, OR: [{ status: 'IN_TRANSIT' }, { onTheWayAt: { not: null } }] },
      }),
      this.prisma.order.count({ where: { distributorId, status: 'DELIVERED', deliveredAt: { gte: today.start, lt: today.end } } }),
    ]);
    return {
      distributor: {
        businessName: distributor.businessName,
        code: distributor.code ?? '',
        status: distributor.status,
        storeSet: distributor.homeStoreId !== null,
      },
      wallet,
      orders: { active, onTheWay, deliveredToday },
    };
  }

  // ---------- create ----------

  /**
   * `POST /distributors` (office, Idempotency-Key), rules in order (API_CONTRACT §7.3): the key (a
   * retry replays, compared on phone and business name); the phone (normalised, used by no user);
   * the code (given or from the initials, unique); the store pin (an active zone); the CNIC (13
   * digits, encrypted, unique by its blind index). One transaction creates the user (PENDING), the
   * store and the distributor, audited `distributor.create`.
   */
  async create(actor: Actor, body: CreateDistributorInput, key: string | undefined): Promise<DistributorDto | IdempotentResponse<DistributorDto>> {
    if (key) {
      const existing = await this.prisma.distributor.findUnique({ where: { clientRequestId: key }, select: { id: true } });
      if (existing) return replayed(await this.replayCreate(existing.id, body));
    }

    const phone = normalizePkPhone(body.phone);
    if (!phone) throw invalidPhone();
    await this.assertPhoneFree(this.prisma, phone);

    const code = body.code ?? (await this.defaultCode(body.businessName));
    if (body.code) await this.assertCodeFree(this.prisma, body.code);

    const zone = await this.zones.findContainingPoint(body.store.lat, body.store.lng);
    if (!zone) throw new AppError('STORE_OUTSIDE_ZONES');

    const cnic = body.cnic ?? null;
    const cnicIndex = cnic ? this.crypto.blindIndex(cnic) : null;
    if (cnic && cnicIndex) await this.assertCnicFree(this.prisma, cnic, cnicIndex);
    const cnicEncrypted = cnic ? this.encryptCnic(cnic) : null;

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            phone,
            name: body.name,
            email: body.email ?? null,
            role: UserRole.DISTRIBUTOR,
            status: UserStatus.PENDING,
            cnicEncrypted,
            cnicIndex,
          },
          select: { id: true },
        });
        const store = await this.stores.insertStore(tx, body.store);
        const distributor = await tx.distributor.create({
          data: {
            userId: user.id,
            businessName: body.businessName,
            code,
            homeStoreId: store.id,
            status: DistributorStatus.PENDING,
            clientRequestId: key ?? null,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: 'distributor.create',
            actor,
            resourceType: 'distributor',
            resourceId: distributor.id,
            distributorId: distributor.id,
            after: {
              businessName: body.businessName,
              code,
              name: body.name,
              phone,
              store: { name: body.store.name, address: body.store.address, zoneName: store.zoneName },
            },
            diff: { distributor: body.businessName, code },
          },
          tx,
        );
        return distributor.id;
      }, LOCKING_TX);
    } catch (error) {
      if (key && isUniqueViolation(error, 'distributors_client_request_id_key')) {
        const first = await this.prisma.distributor.findUnique({ where: { clientRequestId: key }, select: { id: true } });
        if (first) return replayed(await this.replayCreate(first.id, body));
      }
      if (isUniqueViolation(error, 'users_phone_key')) await this.assertPhoneFree(this.prisma, phone);
      if (isUniqueViolation(error, 'distributors_code_key')) throw new AppError('DISTRIBUTOR_CODE_IN_USE', { code });
      throw error;
    }
    return this.byId(id, 'OFFICE');
  }

  // ---------- edits ----------

  /**
   * `PATCH /distributors/:id` (office) `{ businessName?, name?, email?, phone? }`. A phone change is
   * normalised and unique and bumps the user's `tv`, so the shop signs in again. Audited
   * `distributor.update` with before and after; a body that changes nothing writes nothing.
   */
  async update(actor: Actor, id: string, body: UpdateDistributorInput): Promise<DistributorDto> {
    const phone = body.phone === undefined ? undefined : normalizePkPhone(body.phone);
    if (phone === null) throw invalidPhone();
    let signedOutUserId: string | null;
    try {
      signedOutUserId = await this.prisma.$transaction(async (tx): Promise<string | null> => {
        const current = await this.lock(tx, id);
        const before: ContactSnapshot = {
          businessName: current.businessName,
          name: current.user.name,
          email: current.user.email,
          phone: current.user.phone,
        };
        const after: ContactSnapshot = {
          businessName: body.businessName ?? before.businessName,
          name: body.name ?? before.name,
          email: body.email === undefined ? before.email : body.email,
          phone: phone ?? before.phone,
        };
        const phoneChanges = after.phone !== before.phone;
        if (phoneChanges) await this.assertPhoneFree(tx, after.phone, current.user.id);
        if (JSON.stringify(before) === JSON.stringify(after)) return null;
        if (after.businessName !== before.businessName) {
          await tx.distributor.update({ where: { id }, data: { businessName: after.businessName } });
        }
        await tx.user.update({
          where: { id: current.user.id },
          data: {
            name: after.name,
            email: after.email,
            phone: after.phone,
            ...(phoneChanges ? { tokenVersion: { increment: 1 } } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'distributor.update',
            actor,
            resourceType: 'distributor',
            resourceId: id,
            distributorId: id,
            before,
            after,
            diff: { distributor: after.businessName },
          },
          tx,
        );
        return phoneChanges ? current.user.id : null;
      }, LOCKING_TX);
    } catch (error) {
      if (phone && isUniqueViolation(error, 'users_phone_key')) await this.assertPhoneFree(this.prisma, phone);
      throw error;
    }
    // The old tokens stop on their next request, not when the 60-second session cache expires (§3.3).
    if (signedOutUserId) this.sessions.forget(signedOutUserId);
    return this.byId(id, 'OFFICE');
  }

  /**
   * `PATCH /distributors/:id/store` (office). The zone is recomputed from a moved pin
   * (`STORE_OUTSIDE_ZONES`). A legacy distributor without a store gets one here (all four fields
   * needed), which is how ops creates the missing stores before the switch-over. Audited
   * `distributor.store_update`.
   */
  async updateStore(actor: Actor, id: string, body: UpdateDistributorStoreInput): Promise<DistributorDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      let before: StoreSnapshot | null;
      let after: StoreSnapshot;
      if (current.homeStoreId) {
        const change = await this.stores.updateStoreRow(tx, current.homeStoreId, body);
        if (!change.changed) return;
        before = change.before;
        after = change.after;
      } else {
        const missing = (['name', 'address', 'lat', 'lng'] as const).filter((field) => body[field] === undefined);
        if (missing.length) {
          throw new AppError('VALIDATION_FAILED', {
            fields: missing.map((field) => ({ path: field, code: 'REQUIRED', message: validationMessage('REQUIRED') })),
          });
        }
        const store = { name: body.name as string, address: body.address as string, lat: body.lat as number, lng: body.lng as number };
        const created = await this.stores.insertStore(tx, store);
        await tx.distributor.update({ where: { id }, data: { homeStoreId: created.id } });
        before = null;
        after = { ...store, zoneId: created.zoneId, zoneName: created.zoneName };
      }
      await this.audit.record(
        {
          action: 'distributor.store_update',
          actor,
          resourceType: 'distributor',
          resourceId: id,
          distributorId: id,
          before,
          after,
          diff: { distributor: current.businessName },
        },
        tx,
      );
    }, LOCKING_TX);
    return this.byId(id, 'OFFICE');
  }

  /** `PATCH /distributors/:id/code` (office): only before the distributor's first order. */
  async changeCode(actor: Actor, id: string, code: string): Promise<DistributorDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await this.lock(tx, id);
        if (current.code === code) return;
        // Orders lock this row to take a number, so no order can slip in between the check and the change.
        if ((await tx.order.count({ where: { distributorId: id } })) > 0) throw new AppError('DISTRIBUTOR_CODE_LOCKED');
        await this.assertCodeFree(tx, code, id);
        await tx.distributor.update({ where: { id }, data: { code } });
        await this.audit.record(
          {
            action: 'distributor.code_change',
            actor,
            resourceType: 'distributor',
            resourceId: id,
            distributorId: id,
            before: { code: current.code },
            after: { code },
            diff: { distributor: current.businessName, from: current.code, to: code },
          },
          tx,
        );
      }, LOCKING_TX);
    } catch (error) {
      if (isUniqueViolation(error, 'distributors_code_key')) throw new AppError('DISTRIBUTOR_CODE_IN_USE', { code });
      throw error;
    }
    return this.byId(id, 'OFFICE');
  }

  /**
   * `PATCH /distributors/:id/approve` (office): activates from PENDING, or reactivates from SUSPENDED
   * with a required reason. Both status columns become ACTIVE, audited `distributor.activate` with
   * `{ from }`. Already ACTIVE: 200 `X-Already-Applied`, no audit row.
   */
  async approve(actor: Actor, id: string, body: ApproveDistributorInput): Promise<DistributorDto | IdempotentResponse<DistributorDto>> {
    const changedUserId = await this.prisma.$transaction(async (tx): Promise<string | null> => {
      const current = await this.lock(tx, id);
      if (current.status === DistributorStatus.ACTIVE && current.user.status === UserStatus.ACTIVE) return null;
      if (current.status === DistributorStatus.SUSPENDED && !body.reason) throw reasonRequired();
      await tx.distributor.update({ where: { id }, data: { status: DistributorStatus.ACTIVE } });
      await tx.user.update({ where: { id: current.user.id }, data: { status: UserStatus.ACTIVE } });
      await this.audit.record(
        {
          action: 'distributor.activate',
          actor,
          resourceType: 'distributor',
          resourceId: id,
          distributorId: id,
          reason: body.reason ?? null,
          diff: { from: current.status, distributor: current.businessName },
        },
        tx,
      );
      return current.user.id;
    }, LOCKING_TX);
    if (changedUserId) this.sessions.forget(changedUserId);
    const dto = await this.byId(id, 'OFFICE');
    return changedUserId ? dto : alreadyApplied(dto);
  }

  /**
   * `PATCH /distributors/:id/suspend` (office) `{ reason }`: both status columns become SUSPENDED and
   * the user's `tv` is bumped, so the shop is signed out (401 AUTH_SESSION_REVOKED) and a new sign-in
   * gets 403 AUTH_ACCOUNT_NOT_ACTIVE. Placed orders continue; the balance is unchanged. A repeat: 200
   * `X-Already-Applied`, no audit row.
   */
  async suspend(actor: Actor, id: string, reason: string): Promise<DistributorDto | IdempotentResponse<DistributorDto>> {
    const changedUserId = await this.prisma.$transaction(async (tx): Promise<string | null> => {
      const current = await this.lock(tx, id);
      if (current.status === DistributorStatus.SUSPENDED && current.user.status === UserStatus.SUSPENDED) return null;
      await tx.distributor.update({ where: { id }, data: { status: DistributorStatus.SUSPENDED } });
      await tx.user.update({
        where: { id: current.user.id },
        data: { status: UserStatus.SUSPENDED, tokenVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: 'distributor.suspend',
          actor,
          resourceType: 'distributor',
          resourceId: id,
          distributorId: id,
          reason,
          diff: { from: current.status, distributor: current.businessName },
        },
        tx,
      );
      return current.user.id;
    }, LOCKING_TX);
    // Signed out on the next request, not when the 60-second session cache expires (§3.3).
    if (changedUserId) this.sessions.forget(changedUserId);
    const dto = await this.byId(id, 'OFFICE');
    return changedUserId ? dto : alreadyApplied(dto);
  }

  // ---------- the DTO ----------

  /** `DistributorDto`s in the order of `ids` (API_CONTRACT §7.3). The CNIC itself never leaves. */
  private async dtos(ids: readonly string[], view: DistributorView): Promise<DistributorDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.distributor.findMany({ where: { id: { in: [...ids] } }, select: DISTRIBUTOR_SELECT });
    const storeIds = rows.map((row) => row.homeStoreId).filter((id): id is string => id !== null);
    const [coverage, pins, withOrders, wallets, apps] = await Promise.all([
      this.pricing.coverage(rows.map((row) => row.id)),
      this.storePins(storeIds),
      this.prisma.order.groupBy({ by: ['distributorId'], where: { distributorId: { in: rows.map((row) => row.id) } }, _count: { _all: true } }),
      Promise.all(rows.map((row) => this.wallet.summary(row.id))),
      view === 'OFFICE' ? this.appSeen.viewsOf('distributor', rows.map((row) => row.user)) : Promise.resolve([]),
    ]);
    const locked = new Set(withOrders.filter((row) => row._count._all > 0).map((row) => row.distributorId));
    const byId = new Map(
      rows.map((row, index) => {
        const prices = coverage.get(row.id) ?? { priced: 0, total: 0 };
        const pin = row.homeStoreId ? pins.get(row.homeStoreId) : undefined;
        const appPasswordSet = row.user.passwordHash !== null;
        const store =
          row.homeStore && pin
            ? {
                id: row.homeStore.id,
                name: row.homeStore.name,
                address: row.homeStore.address,
                lat: pin.lat,
                lng: pin.lng,
                zone: { id: row.homeStore.zone.id, name: row.homeStore.zone.name },
              }
            : null;
        const dto: DistributorDto = {
          id: row.id,
          userId: row.user.id,
          code: row.code ?? '',
          businessName: row.businessName,
          status: row.status,
          contact: { name: row.user.name, phone: row.user.phone, email: row.user.email },
          store,
          wallet: { balancePaisa: wallets[index].balancePaisa },
          prices,
          appPasswordSet,
          codeLocked: locked.has(row.id),
        };
        if (view === 'OFFICE') {
          dto.readiness = {
            storeSet: store !== null,
            pricesComplete: prices.total > 0 && prices.priced === prices.total,
            appPasswordSet,
          };
          dto.cnicMasked = this.maskedCnic(row.user);
          dto.app = apps[index];
        }
        return [row.id, dto] as const;
      }),
    );
    return ids.map((id) => byId.get(id)).filter((dto): dto is DistributorDto => dto !== undefined);
  }

  private async storePins(storeIds: readonly string[]): Promise<Map<string, { lat: number; lng: number }>> {
    if (storeIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; lat: number; lng: number }>>`
      SELECT id, ST_Y(location) AS lat, ST_X(location) AS lng FROM stores WHERE id = ANY(${[...storeIds]}::uuid[])`;
    return new Map(rows.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
  }

  /** "*****-****567-1" from the encrypted CNIC (or an old plain one); null without one. */
  private maskedCnic(user: { cnicEncrypted: Uint8Array | Buffer | null; cnic: string | null }): string | null {
    if (user.cnicEncrypted && user.cnicEncrypted.length > 0) {
      try {
        return maskCnic(this.crypto.decrypt(Buffer.from(user.cnicEncrypted).toString('utf8')));
      } catch {
        return null;
      }
    }
    return maskCnic(user.cnic);
  }

  // ---------- internals ----------

  /** The stored form of a CNIC: the encryption's text (base64 envelope) as bytes in `users.cnic_encrypted`. */
  private encryptCnic(cnic: string): Buffer | null {
    const cipher = this.crypto.encrypt(cnic);
    return cipher ? Buffer.from(cipher, 'utf8') : null;
  }

  private async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM distributors WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError('NOT_FOUND');
    return tx.distributor.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        code: true,
        businessName: true,
        status: true,
        homeStoreId: true,
        user: { select: { id: true, name: true, phone: true, email: true, status: true } },
      },
    });
  }

  /** 409 USER_PHONE_IN_USE when any other user has the phone (never an upsert of their role). */
  private async assertPhoneFree(db: Db, phone: string, exceptUserId?: string): Promise<void> {
    const user = await db.user.findUnique({ where: { phone }, select: { id: true, role: true } });
    if (user && user.id !== exceptUserId) throw new AppError('USER_PHONE_IN_USE', { existingRole: user.role });
  }

  private async assertCodeFree(db: Db, code: string, exceptId?: string): Promise<void> {
    const owner = await db.distributor.findUnique({ where: { code }, select: { id: true } });
    if (owner && owner.id !== exceptId) throw new AppError('DISTRIBUTOR_CODE_IN_USE', { code });
  }

  /** 409 USER_CNIC_IN_USE when any user has this CNIC: by its blind index, or as an old plain value. */
  private async assertCnicFree(db: Db, cnic: string, cnicIndex: string): Promise<void> {
    const dashed = `${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}`;
    const user = await db.user.findFirst({
      where: { OR: [{ cnicIndex }, { cnic: { in: [cnic, dashed] } }] },
      select: { id: true },
    });
    if (user) throw new AppError('USER_CNIC_IN_USE');
  }

  /** The first free code from the business initials ("AG", then "AG2", "AG3" …). */
  private async defaultCode(businessName: string): Promise<string> {
    const candidates = codeCandidates(businessName);
    const taken = new Set(
      (await this.prisma.distributor.findMany({ where: { code: { in: candidates } }, select: { code: true } })).map((row) => row.code),
    );
    const free = candidates.find((code) => !taken.has(code));
    if (!free) throw new AppError('DISTRIBUTOR_CODE_IN_USE', { code: candidates[0] });
    return free;
  }

  private async replayCreate(id: string, body: CreateDistributorInput): Promise<DistributorDto> {
    const existing = await this.prisma.distributor.findUniqueOrThrow({
      where: { id },
      select: { businessName: true, user: { select: { phone: true } } },
    });
    assertSameRequest(
      { phone: existing.user.phone, businessName: existing.businessName },
      { phone: normalizePkPhone(body.phone) ?? body.phone, businessName: body.businessName },
      ['phone', 'businessName'],
    );
    return this.byId(id, 'OFFICE');
  }
}
