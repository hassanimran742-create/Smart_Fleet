import { Injectable } from '@nestjs/common';
import { CustodyType, CylinderState } from '@prisma/client';
import type { BulkRegisteredCylinder } from '@smartfleet/shared-types';
import type { BulkRegisterInput } from '@smartfleet/shared-validation';
import { randomBytes } from 'crypto';
import { actorUserId, type Actor } from '../../common/auth/actor';
import { canSeeCylinder, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { cylinderShortCode } from '../custody/cylinder-codes';
import { ScanService } from '../custody/scan.service';
import { LOCKING_TX } from '../orders/support/tx';
import { sizeLabelOf } from '../pricing/size-label';

const LIST_LIMIT = 200;

/**
 * Cylinders (API_CONTRACT §7.2, §9.5). A cylinder's holder changes only by a scan (custody), except its
 * first one: bulk registration always places new cylinders in the distributor's one store, each with
 * its next short number and a REGISTERED move.
 */
@Injectable()
export class CylindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly scans: ScanService,
  ) {}

  /** `GET /cylinders/by-qr/:qr`: the office or the owning distributor (404 otherwise). */
  async findByQr(caller: PolicyCaller, qr: string) {
    const cylinder = await this.prisma.cylinder.findUnique({
      where: { qrCode: qr },
      include: {
        cylinderType: true,
        distributor: { select: { id: true, businessName: true, code: true } },
      },
    });
    return canSeeCylinder(caller, cylinder);
  }

  /** `GET /cylinders` (office). */
  list(distributorId?: string) {
    return this.prisma.cylinder.findMany({
      where: distributorId ? { distributorId } : undefined,
      include: { cylinderType: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    });
  }

  /**
   * `POST /cylinders/bulk-register` (office): 1–500 cylinders of one size, FULL or EMPTY, always first
   * held by the distributor's home store (a van or another store is 400 NOT_ALLOWED). Generated codes
   * read `<typeCode>-<8 hex>`; given serials are both the serial and the QR value. A serial already
   * used is 409 CONFLICT_DUPLICATE and nothing is created. From Inc 2 (§9.5) each gets the next
   * `short_no` from `next_cylinder_no` and one REGISTERED event (source REGISTRATION) in the same
   * transaction, and the answer is 201 `[{ id, code, shortNo, shortCode, sizeLabel }]` for the labels.
   * Audited `cylinders.bulk_register`.
   */
  async bulkRegister(actor: Actor, body: BulkRegisterInput): Promise<BulkRegisteredCylinder[]> {
    const [distributor, type] = await Promise.all([
      this.prisma.distributor.findUnique({
        where: { id: body.distributorId },
        select: { id: true, homeStoreId: true, businessName: true, code: true },
      }),
      this.prisma.cylinderType.findUnique({ where: { id: body.cylinderTypeId }, select: { id: true, code: true, name: true, weightKg: true } }),
    ]);
    if (!distributor) throw new AppError('NOT_FOUND', { field: 'distributorId' });
    if (!type) throw new AppError('NOT_FOUND', { field: 'cylinderTypeId' });
    const storeId = distributor.homeStoreId;
    if (!storeId) throw new AppError('DISTRIBUTOR_NO_STORE');
    if (body.initialCustodyId && body.initialCustodyId !== storeId) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'initialCustodyId', code: 'NOT_ALLOWED', message: validationMessage('NOT_ALLOWED') }],
      });
    }
    const userId = actorUserId(actor);
    if (!userId) throw new AppError('PERMISSION_DENIED');

    const serials = body.serials ?? Array.from({ length: body.quantity ?? 0 }, () => `${type.code}-${randomBytes(4).toString('hex').toUpperCase()}`);
    const used = await this.prisma.cylinder.count({ where: { OR: [{ serial: { in: serials } }, { qrCode: { in: serials } }] } });
    if (used > 0) throw new AppError('CONFLICT_DUPLICATE');
    const state = body.state === 'EMPTY' ? CylinderState.EMPTY : CylinderState.FULL;
    const sizeLabel = sizeLabelOf(type);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // The label numbers come from the distributor's counter, in this transaction (ADR-22).
        const [{ first }] = await tx.$queryRaw<Array<{ first: number }>>`
          UPDATE distributors SET next_cylinder_no = next_cylinder_no + ${serials.length}, updated_at = (now() AT TIME ZONE 'UTC')
          WHERE id = ${distributor.id}::uuid
          RETURNING next_cylinder_no - ${serials.length} AS first`;
        const start = Number(first);
        await tx.cylinder.createMany({
          data: serials.map((serial, index) => ({
            serial,
            qrCode: serial,
            distributorId: distributor.id,
            cylinderTypeId: type.id,
            shortNo: start + index,
            custodyType: CustodyType.STORE,
            custodyId: storeId,
            state,
          })),
        });
        const created = await tx.cylinder.findMany({
          where: { serial: { in: serials } },
          orderBy: [{ shortNo: 'asc' }],
          select: { id: true, qrCode: true, shortNo: true },
        });
        await this.scans.registerMoves(tx, { actorUserId: userId, storeId, cylinderIds: created.map((cylinder) => cylinder.id) });
        await tx.inventoryLot.upsert({
          where: {
            inventory_unique: { holderType: CustodyType.STORE, holderId: storeId, distributorId: distributor.id, cylinderTypeId: type.id, state },
          },
          update: { count: { increment: created.length } },
          create: { holderType: CustodyType.STORE, holderId: storeId, distributorId: distributor.id, cylinderTypeId: type.id, state, count: created.length },
        });
        await this.audit.record(
          {
            action: 'cylinders.bulk_register',
            actor,
            resourceType: 'distributor',
            resourceId: distributor.id,
            distributorId: distributor.id,
            diff: {
              cylinderTypeId: type.id,
              count: created.length,
              state,
              distributor: distributor.businessName,
              from: cylinderShortCode(distributor.code, start),
              to: cylinderShortCode(distributor.code, start + created.length - 1),
            },
          },
          tx,
        );
        return created.map((cylinder) => ({
          id: cylinder.id,
          code: cylinder.qrCode,
          shortNo: cylinder.shortNo as number,
          shortCode: cylinderShortCode(distributor.code, cylinder.shortNo) as string,
          sizeLabel,
        }));
      }, LOCKING_TX);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('CONFLICT_DUPLICATE', undefined, { cause: error });
      throw error;
    }
  }
}
