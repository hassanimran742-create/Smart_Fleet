import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ExpenseTypeDto } from '@smartfleet/shared-types';
import { toExpenseTypeNameKey } from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  EXPENSE_TYPE_INCLUDE,
  EXPENSE_TYPE_RESOURCE,
  toExpenseTypeDto,
  UUID,
  type ExpenseTypeRow,
} from './expense-rows';
import { ExpensesClock } from './expenses.clock';

const NAME_KEY_CONSTRAINT = 'expense_types_name_key_key';

/**
 * Expense types, managed by the office (API_CONTRACT §7.12, ADR-14): add, rename, archive, restore.
 * Seeded types keep their code for ever; Petrol and Other (`is_system`) can't be archived. A name is
 * unique ignoring case and spacing (`name_key`), archived types included: to use an archived type's
 * name again, restore it.
 */
@Injectable()
export class ExpenseTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: ExpensesClock,
  ) {}

  /** `GET /expense-types`: by `sortOrder`, then name; archived ones only when asked for. */
  async list(includeArchived: boolean): Promise<ExpenseTypeDto[]> {
    const rows = await this.prisma.expenseType.findMany({
      where: includeArchived ? undefined : { archivedAt: null },
      include: EXPENSE_TYPE_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toExpenseTypeDto);
  }

  /** `POST /expense-types { name }`: a custom type (no code, never a system type). */
  async create(name: string, actor: UserActor): Promise<ExpenseTypeDto> {
    const nameKey = toExpenseTypeNameKey(name);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await this.assertNameFree(tx, nameKey, null);
        const created = await tx.expenseType.create({
          data: { name, nameKey, code: null, isSystem: false, createdByUserId: actor.userId },
          include: EXPENSE_TYPE_INCLUDE,
        });
        await this.audit.record(
          {
            action: 'expense_type.create',
            actor,
            resourceType: EXPENSE_TYPE_RESOURCE,
            resourceId: created.id,
            after: { name: created.name },
          },
          tx,
        );
        return created;
      });
      return toExpenseTypeDto(row);
    } catch (error) {
      throw await this.nameTakenOr(error, nameKey);
    }
  }

  /**
   * `PATCH /expense-types/:id { name }`: any type may be renamed, its code never changes. The same name
   * again changes nothing; a new spelling of its own name ("tyres" → "Tyres") is allowed.
   */
  async rename(id: string, name: string, actor: UserActor): Promise<ExpenseTypeDto> {
    const nameKey = toExpenseTypeNameKey(name);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const current = await this.lock(tx, id);
        if (current.name === name) return current;
        await this.assertNameFree(tx, nameKey, current.id);
        const renamed = await tx.expenseType.update({
          where: { id: current.id },
          data: { name, nameKey },
          include: EXPENSE_TYPE_INCLUDE,
        });
        await this.audit.record(
          {
            action: 'expense_type.rename',
            actor,
            resourceType: EXPENSE_TYPE_RESOURCE,
            resourceId: current.id,
            before: { name: current.name },
            after: { name: renamed.name },
          },
          tx,
        );
        return renamed;
      });
      return toExpenseTypeDto(row);
    } catch (error) {
      throw await this.nameTakenOr(error, nameKey);
    }
  }

  /** `POST /expense-types/:id/archive`: Petrol and Other are locked; a repeat answers X-Already-Applied. */
  async archive(id: string, actor: UserActor): Promise<ExpenseTypeDto | IdempotentResponse<ExpenseTypeDto>> {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.isSystem) throw new AppError('EXPENSE_TYPE_LOCKED', { name: current.name });
      if (current.archivedAt) return { row: current, repeated: true };
      const archived = await tx.expenseType.update({
        where: { id: current.id },
        data: { archivedAt: this.clock.now() },
        include: EXPENSE_TYPE_INCLUDE,
      });
      await this.audit.record(
        {
          action: 'expense_type.archive',
          actor,
          resourceType: EXPENSE_TYPE_RESOURCE,
          resourceId: current.id,
          before: { archived: false },
          after: { name: archived.name, archived: true },
        },
        tx,
      );
      return { row: archived, repeated: false };
    });
    const dto = toExpenseTypeDto(result.row);
    return result.repeated ? alreadyApplied(dto) : dto;
  }

  /** `POST /expense-types/:id/restore`: back in the type lists, its old expenses with it. */
  async restore(id: string, actor: UserActor): Promise<ExpenseTypeDto | IdempotentResponse<ExpenseTypeDto>> {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (!current.archivedAt) return { row: current, repeated: true };
      const restored = await tx.expenseType.update({
        where: { id: current.id },
        data: { archivedAt: null },
        include: EXPENSE_TYPE_INCLUDE,
      });
      await this.audit.record(
        {
          action: 'expense_type.restore',
          actor,
          resourceType: EXPENSE_TYPE_RESOURCE,
          resourceId: current.id,
          before: { archived: true },
          after: { name: restored.name, archived: false },
        },
        tx,
      );
      return { row: restored, repeated: false };
    });
    const dto = toExpenseTypeDto(result.row);
    return result.repeated ? alreadyApplied(dto) : dto;
  }

  /** Locks the type row for this transaction; 404 NOT_FOUND for an unknown or malformed id. */
  private async lock(tx: Prisma.TransactionClient, id: string): Promise<ExpenseTypeRow> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM expense_types WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new AppError('NOT_FOUND');
    return tx.expenseType.findUniqueOrThrow({ where: { id: locked[0].id }, include: EXPENSE_TYPE_INCLUDE });
  }

  /** EXPENSE_TYPE_NAME_TAKEN with the other type's name as stored (G13-02), when the key is used. */
  private async assertNameFree(tx: Prisma.TransactionClient, nameKey: string, selfId: string | null): Promise<void> {
    const taken = await tx.expenseType.findUnique({ where: { nameKey }, select: { id: true, name: true } });
    if (taken && taken.id !== selfId) throw new AppError('EXPENSE_TYPE_NAME_TAKEN', { name: taken.name });
  }

  /**
   * Two saves of one name at the same moment: the loser's insert hits `expense_types_name_key_key`.
   * It answers like the check would have, naming the type that won.
   */
  private async nameTakenOr(error: unknown, nameKey: string): Promise<unknown> {
    if (!isUniqueViolation(error, NAME_KEY_CONSTRAINT)) return error;
    const taken = await this.prisma.expenseType.findUnique({ where: { nameKey }, select: { name: true } });
    return taken ? new AppError('EXPENSE_TYPE_NAME_TAKEN', { name: taken.name }) : error;
  }
}
