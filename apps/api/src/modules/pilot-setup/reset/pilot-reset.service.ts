import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatNo, type HumanNoKind } from '@smartfleet/shared-utils';
import { systemActor } from '../../../common/auth/actor';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import {
  ABOUT_DELETED,
  ANY_TABLE,
  DELETE_ORDER,
  OFFICE_ROLES,
  OWNED_BY,
  POINTS_AT,
  ROW_NAME_EXPRESSION,
  type OwnedBy,
} from './reset-graph';

/** The audit label of the reset's one audit row (API_CONTRACT Appendix B `pilot.reset`). */
export const PILOT_RESET_LABEL = 'cli:pilot-reset';

/** The plan's working table: one row per row to delete. Temporary, gone with the transaction. */
const PLAN = 'pilot_reset_rows';

/** A reset reads most tables and deletes in one go; a slow test server gets time. */
const RESET_TX = { maxWait: 15_000, timeout: 300_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } as const;

const NAME = /^[a-z_]+$/;

/** Identifiers come from reset-graph.ts only; this keeps a typo there from ever reaching SQL unquoted. */
function ident(name: string): string {
  if (!NAME.test(name)) throw new Error(`pilot reset: bad identifier ${name}`);
  return name;
}

function tableList(tables: readonly string[]): string {
  return tables.map((table) => `'${ident(table)}'`).join(', ');
}

/** A row that stays and points at a row the plan deletes: the reset refuses on the first. */
export interface KeptPointer {
  table: string;
  id: string;
  /** Its short number (LG-0001, LG-C0003 …) or another name, when it has one. */
  name: string | null;
  column: string;
  targetTable: string;
  targetId: string;
  targetName: string | null;
}

export interface ResetPlanRow {
  table: string;
  rows: number;
}

export interface ResetResult {
  /** Rows per table the plan deletes, in deletion order (tables with none left out). */
  plan: ResetPlanRow[];
  total: number;
  /** Set when a kept row points at a deleted one: nothing was deleted. */
  blocked: KeptPointer | null;
  /** True when the rows were deleted and the `pilot.reset` row written. */
  executed: boolean;
}

/** Thrown to roll back a plan that only had to be shown (no --yes, --dry-run, or refused). */
class PlanOnly extends Error {
  constructor(readonly result: ResetResult) {
    super('plan only');
  }
}

/**
 * The pilot reset (API_CONTRACT §10.3, settled point G10-02). It plans the deletion of every `is_test`
 * distributor, user and van and what hangs off them (reset-graph.ts), refuses when a row it keeps points
 * at a row it would delete, and otherwise deletes everything in foreign-key order in one transaction,
 * then writes one `pilot.reset` audit row. Office users are never deleted; storage objects stay in the
 * bucket (only the `stored_files` rows go).
 */
@Injectable()
export class PilotResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** `current_database()`, which `--confirm-db` must name on production. */
  async currentDatabase(): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    return rows[0].name;
  }

  /** Plans the reset; with `execute`, deletes (unless refused) and writes the audit row, all in one transaction. */
  async run(options: { execute: boolean }): Promise<ResetResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.buildPlan(tx);
        const plan = await this.planRows(tx);
        const total = plan.reduce((sum, row) => sum + row.rows, 0);
        const blocked = total > 0 ? await this.firstKeptPointer(tx) : null;
        if (blocked || !options.execute) throw new PlanOnly({ plan, total, blocked, executed: false });

        const deleted: Record<string, number> = {};
        for (const table of DELETE_ORDER) {
          const count = await tx.$executeRawUnsafe(
            `DELETE FROM ${ident(table)} WHERE id IN (SELECT id FROM ${PLAN} WHERE tbl = '${ident(table)}')`,
          );
          if (count > 0) deleted[table] = count;
        }
        await this.audit.record(
          {
            action: 'pilot.reset',
            actor: systemActor(PILOT_RESET_LABEL),
            resourceType: 'pilot',
            diff: { deleted, total: Object.values(deleted).reduce((sum, count) => sum + count, 0) },
          },
          tx,
        );
        return { plan, total, blocked: null, executed: true };
      }, RESET_TX);
    } catch (error) {
      if (error instanceof PlanOnly) return error.result;
      throw error;
    }
  }

  // ---------- the plan ----------

  private async add(tx: Prisma.TransactionClient, sql: string): Promise<number> {
    return tx.$executeRawUnsafe(sql);
  }

  private parentsIn(parents: readonly string[]): string {
    return parents.includes(ANY_TABLE) ? `SELECT id FROM ${PLAN}` : `SELECT id FROM ${PLAN} WHERE tbl IN (${tableList(parents)})`;
  }

  private ownedSql(edge: OwnedBy): string {
    return `INSERT INTO ${PLAN} (tbl, id)
      SELECT '${ident(edge.table)}', t.id FROM ${ident(edge.table)} t
      WHERE t.${ident(edge.column)} IN (${this.parentsIn(edge.parents)})
      ON CONFLICT DO NOTHING`;
  }

  /** Fills the plan table: the test rows, then what hangs off them until nothing is added, then the rows about them. */
  private async buildPlan(tx: Prisma.TransactionClient): Promise<void> {
    const office = OFFICE_ROLES.map((role) => `'${role}'`).join(', ');
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${PLAN} (tbl text NOT NULL, id uuid NOT NULL, PRIMARY KEY (tbl, id)) ON COMMIT DROP`);
    await this.add(tx, `INSERT INTO ${PLAN} (tbl, id) SELECT 'distributors', id FROM distributors WHERE is_test ON CONFLICT DO NOTHING`);
    await this.add(tx, `INSERT INTO ${PLAN} (tbl, id) SELECT 'users', id FROM users WHERE is_test AND role::text NOT IN (${office}) ON CONFLICT DO NOTHING`);
    await this.add(tx, `INSERT INTO ${PLAN} (tbl, id) SELECT 'vehicles', id FROM vehicles WHERE is_test ON CONFLICT DO NOTHING`);

    for (let pass = 0; pass < 25; pass++) {
      let added = 0;
      // A deleted shop's or driver's login goes with it (never an office login), and so does the shop's one store.
      added += await this.add(
        tx,
        `INSERT INTO ${PLAN} (tbl, id)
         SELECT 'users', u.id FROM distributors d JOIN users u ON u.id = d.user_id
         WHERE d.id IN (SELECT id FROM ${PLAN} WHERE tbl = 'distributors') AND u.role::text NOT IN (${office})
         ON CONFLICT DO NOTHING`,
      );
      added += await this.add(
        tx,
        `INSERT INTO ${PLAN} (tbl, id)
         SELECT 'users', u.id FROM drivers dr JOIN users u ON u.id = dr.user_id
         WHERE dr.id IN (SELECT id FROM ${PLAN} WHERE tbl = 'drivers') AND u.role::text NOT IN (${office})
         ON CONFLICT DO NOTHING`,
      );
      added += await this.add(
        tx,
        `INSERT INTO ${PLAN} (tbl, id)
         SELECT 'stores', d.home_store_id FROM distributors d
         WHERE d.id IN (SELECT id FROM ${PLAN} WHERE tbl = 'distributors')
         ON CONFLICT DO NOTHING`,
      );
      for (const edge of OWNED_BY) added += await this.add(tx, this.ownedSql(edge));
      if (added === 0) break;
    }
    for (const edge of ABOUT_DELETED) await this.add(tx, this.ownedSql(edge));
  }

  private async planRows(tx: Prisma.TransactionClient): Promise<ResetPlanRow[]> {
    const rows = await tx.$queryRawUnsafe<Array<{ tbl: string; rows: number }>>(`SELECT tbl, count(*)::int AS rows FROM ${PLAN} GROUP BY tbl`);
    const byTable = new Map(rows.map((row) => [row.tbl, Number(row.rows)]));
    const unknown = [...byTable.keys()].filter((table) => !(DELETE_ORDER as readonly string[]).includes(table));
    if (unknown.length) throw new Error(`pilot reset: no deletion order for ${unknown.join(', ')}`);
    return DELETE_ORDER.filter((table) => byTable.has(table)).map((table) => ({ table, rows: byTable.get(table) as number }));
  }

  /** The first row that stays but points at a planned deletion, in the order of POINTS_AT. */
  private async firstKeptPointer(tx: Prisma.TransactionClient): Promise<KeptPointer | null> {
    for (const edge of POINTS_AT) {
      const custom = ROW_NAME_EXPRESSION[edge.table];
      const idExpr = custom ?? 't.id::text';
      const stays = custom ? '' : `AND NOT EXISTS (SELECT 1 FROM ${PLAN} r WHERE r.tbl = '${ident(edge.table)}' AND r.id = t.id)`;
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; target: string }>>(
        `SELECT ${idExpr} AS id, t.${ident(edge.column)}::text AS target
         FROM ${ident(edge.table)} t
         WHERE t.${ident(edge.column)} IN (SELECT id FROM ${PLAN} WHERE tbl IN (${tableList(edge.targets)})) ${stays}
         ORDER BY 1
         LIMIT 1`,
      );
      const hit = rows[0];
      if (!hit) continue;
      const [target] = await tx.$queryRawUnsafe<Array<{ tbl: string }>>(
        `SELECT tbl FROM ${PLAN} WHERE id = $1::uuid AND tbl IN (${tableList(edge.targets)}) ORDER BY tbl LIMIT 1`,
        hit.target,
      );
      const targetTable = target?.tbl ?? edge.targets[0];
      return {
        table: edge.table,
        id: hit.id,
        name: custom ? null : await this.describe(tx, edge.table, hit.id),
        column: edge.column,
        targetTable,
        targetId: hit.target,
        targetName: await this.describe(tx, targetTable, hit.target),
      };
    }
    return null;
  }

  /** A row's short number or name for the refusal ("LG-0001", "Kashif's run on LEA-101"), when it has one. */
  private async describe(tx: Prisma.TransactionClient, table: string, id: string): Promise<string | null> {
    const one = async <T>(sql: Prisma.Sql): Promise<T | undefined> => (await tx.$queryRaw<T[]>(sql))[0];
    const numbered = (code: string | null, kind: HumanNoKind, no: number | null) => (no === null || no === undefined ? null : formatNo(code, kind, Number(no)));
    switch (table) {
      case 'orders': {
        const row = await one<{ code: string | null; no: number }>(Prisma.sql`
          SELECT d.code, o.order_no AS no FROM orders o JOIN distributors d ON d.id = o.distributor_id WHERE o.id = ${id}::uuid`);
        return row ? numbered(row.code, 'ORDER', row.no) : null;
      }
      case 'payments': {
        const row = await one<{ code: string | null; no: number }>(Prisma.sql`
          SELECT d.code, p.request_no AS no FROM payments p JOIN distributors d ON d.id = p.distributor_id WHERE p.id = ${id}::uuid`);
        return row ? numbered(row.code, 'TOPUP', row.no) : null;
      }
      case 'filling_orders': {
        const row = await one<{ code: string | null; no: number | null }>(Prisma.sql`
          SELECT d.code, f.refill_no AS no FROM filling_orders f JOIN distributors d ON d.id = f.distributor_id WHERE f.id = ${id}::uuid`);
        return row ? numbered(row.code, 'REFILL', row.no) : null;
      }
      case 'cylinders': {
        const row = await one<{ code: string | null; no: number | null; serial: string }>(Prisma.sql`
          SELECT d.code, c.short_no AS no, c.serial FROM cylinders c JOIN distributors d ON d.id = c.distributor_id WHERE c.id = ${id}::uuid`);
        return row ? numbered(row.code, 'CYLINDER', row.no) ?? row.serial : null;
      }
      case 'cylinder_events': {
        const row = await one<{ code: string | null; no: number | null; type: string }>(Prisma.sql`
          SELECT d.code, c.short_no AS no, e.event_type::text AS type
          FROM cylinder_events e JOIN cylinders c ON c.id = e.cylinder_id JOIN distributors d ON d.id = c.distributor_id
          WHERE e.id = ${id}::uuid`);
        if (!row) return null;
        const cylinder = numbered(row.code, 'CYLINDER', row.no);
        return cylinder ? `${row.type} of ${cylinder}` : row.type;
      }
      case 'trips': {
        const row = await one<{ plate: string; driver: string }>(Prisma.sql`
          SELECT v.plate_no AS plate, u.name AS driver
          FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN drivers dr ON dr.id = t.driver_id JOIN users u ON u.id = dr.user_id
          WHERE t.id = ${id}::uuid`);
        return row ? `${row.driver}'s run on ${row.plate}` : null;
      }
      case 'trip_stops': {
        const row = await one<{ code: string | null; no: number | null; type: string }>(Prisma.sql`
          SELECT d.code, o.order_no AS no, s.stop_type::text AS type
          FROM trip_stops s LEFT JOIN orders o ON o.id = s.order_id LEFT JOIN distributors d ON d.id = o.distributor_id
          WHERE s.id = ${id}::uuid`);
        if (!row) return null;
        const order = numbered(row.code, 'ORDER', row.no);
        return order ? `${row.type} stop of ${order}` : `${row.type} stop`;
      }
      case 'drivers': {
        const row = await one<{ name: string }>(Prisma.sql`SELECT u.name FROM drivers dr JOIN users u ON u.id = dr.user_id WHERE dr.id = ${id}::uuid`);
        return row?.name ?? null;
      }
      case 'users': {
        const row = await one<{ name: string; role: string }>(Prisma.sql`SELECT name, role::text AS role FROM users WHERE id = ${id}::uuid`);
        return row ? `${row.name}, ${row.role}` : null;
      }
      case 'vehicles': {
        const row = await one<{ plate: string }>(Prisma.sql`SELECT plate_no AS plate FROM vehicles WHERE id = ${id}::uuid`);
        return row?.plate ?? null;
      }
      case 'distributors': {
        const row = await one<{ code: string | null; name: string }>(Prisma.sql`SELECT code, business_name AS name FROM distributors WHERE id = ${id}::uuid`);
        return row ? `${row.code ?? '?'} ${row.name}` : null;
      }
      case 'stores': {
        const row = await one<{ name: string }>(Prisma.sql`SELECT name FROM stores WHERE id = ${id}::uuid`);
        return row?.name ?? null;
      }
      case 'clients': {
        const row = await one<{ name: string }>(Prisma.sql`SELECT name FROM clients WHERE id = ${id}::uuid`);
        return row?.name ?? null;
      }
      case 'day_closes': {
        const row = await one<{ code: string | null; date: string }>(Prisma.sql`
          SELECT d.code, to_char(c.business_date, 'YYYY-MM-DD') AS date FROM day_closes c JOIN distributors d ON d.id = c.distributor_id WHERE c.id = ${id}::uuid`);
        return row ? `${row.code ?? '?'} day ${row.date}` : null;
      }
      default:
        return null;
    }
  }
}
