import { Injectable } from '@nestjs/common';
import { CustodyType, CylinderState } from '@prisma/client';
import type { BulkRegisterInput } from '@smartfleet/shared-validation';
import { randomBytes } from 'crypto';
import type { Actor } from '../../common/auth/actor';
import { canSeeCylinder, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LOCKING_TX } from '../orders/support/tx';

const LIST_LIMIT = 200;

/**
 * Cylinders (API_CONTRACT §7.2). A cylinder's holder changes only by a scan (custody), except its first
 * one: bulk registration always places new cylinders in the distributor's one store.
 */
@Injectable()
export class CylindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
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
   * used is 409 CONFLICT_DUPLICATE and nothing is created. Audited `cylinders.bulk_register`.
   */
  async bulkRegister(actor: Actor, body: BulkRegisterInput) {
    const [distributor, type] = await Promise.all([
      this.prisma.distributor.findUnique({ where: { id: body.distributorId }, select: { id: true, homeStoreId: true, businessName: true } }),
      this.prisma.cylinderType.findUnique({ where: { id: body.cylinderTypeId }, select: { id: true, code: true } }),
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

    const serials = body.serials ?? Array.from({ length: body.quantity ?? 0 }, () => `${type.code}-${randomBytes(4).toString('hex').toUpperCase()}`);
    const used = await this.prisma.cylinder.count({ where: { OR: [{ serial: { in: serials } }, { qrCode: { in: serials } }] } });
    if (used > 0) throw new AppError('CONFLICT_DUPLICATE');
    const state = body.state === 'EMPTY' ? CylinderState.EMPTY : CylinderState.FULL;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.cylinder.createMany({
          data: serials.map((serial) => ({
            serial,
            qrCode: serial,
            distributorId: distributor.id,
            cylinderTypeId: type.id,
            custodyType: CustodyType.STORE,
            custodyId: storeId,
            state,
          })),
        });
        const created = await tx.cylinder.findMany({ where: { serial: { in: serials } }, orderBy: [{ serial: 'asc' }] });
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
            diff: { cylinderTypeId: type.id, count: created.length, state, distributor: distributor.businessName },
          },
          tx,
        );
        return created;
      }, LOCKING_TX);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('CONFLICT_DUPLICATE', undefined, { cause: error });
      throw error;
    }
  }
}
