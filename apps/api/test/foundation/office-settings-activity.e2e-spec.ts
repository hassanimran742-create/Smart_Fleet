/**
 * OFF-008 and OFF-010: the office's Settings and Activity log routes (API_CONTRACT §5.2, §6, §7.13).
 * The website side (one PATCH per change with its reason, the filters and paging) is OFF-009 and
 * OFF-011; these prove the routes the pages read.
 */
import type { INestApplication } from '@nestjs/common';
import { SETTING_KEYS } from '@smartfleet/shared-types';
import { addDays, businessDate, businessDayRange } from '@smartfleet/shared-utils';
import { systemActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, type StandardData } from '../helpers/standard-data';

interface SettingRow {
  key: string;
  value: unknown;
  default: unknown;
  type: string;
  editable: boolean;
  public: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  min?: number;
  max?: number;
}

interface AuditItem {
  id: string;
  at: string;
  actor: { kind: string; userId?: string; name?: string; label?: string };
  action: string;
  resourceType: string;
  resourceId: string | null;
  distributorId: string | null;
  reason: string | null;
  diff: Record<string, unknown> | null;
}

describeDb('office: settings and the activity log', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    std = await createStandardData();
    // "topup.account was set with the settings CLI": the CLI writes through SettingsService as SYSTEM.
    await app.get(SettingsService).set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Rehearsal company account', {
      allowNotEditable: true,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => client(app);
  const office = () => authHeader(std.SA1.actor);

  it('OFF-008 the office sees every setting, and a change applies right away with an audit row', async () => {
    // Step 1.
    const list = await http().get('/api/v1/settings').set(office()).expect(200);
    const rows = list.body as SettingRow[];
    expect(rows.map((row) => row.key).sort()).toEqual([...SETTING_KEYS].sort());
    for (const row of rows) {
      for (const field of ['key', 'value', 'default', 'type', 'editable', 'public', 'updatedAt', 'updatedBy']) {
        expect({ key: row.key, has: Object.prototype.hasOwnProperty.call(row, field) ? field : null }).toEqual({ key: row.key, has: field });
      }
    }
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get('dispatch.autoAssign.enabled')).toMatchObject({ value: false, default: false, editable: true });
    expect(byKey.get('orders.maxCylindersPerOrder')).toMatchObject({ value: 30, default: 30, min: 1, max: 100 });
    expect(byKey.get('pricing.deliveryStrategy')).toMatchObject({ editable: false });
    expect(byKey.get('topup.account')).toMatchObject({ editable: false });
    expect(byKey.get('support.hours')).toMatchObject({ value: '9am–9pm' });

    // Step 2.
    const patched = await http()
      .patch('/api/v1/settings/support.hours')
      .set(office())
      .send({ value: '8am–10pm', reason: 'Longer office hours' })
      .expect(200);
    expect(patched.body).toMatchObject({ key: 'support.hours', value: '8am–10pm', updatedBy: { id: std.SA1.id, name: 'Owner' } });

    // Step 3: the settings list and the public config show it at once.
    const again = (await http().get('/api/v1/settings').set(office()).expect(200)).body as SettingRow[];
    expect(again.find((row) => row.key === 'support.hours')).toMatchObject({ value: '8am–10pm', updatedBy: { id: std.SA1.id } });
    const config = await http().get('/api/v1/app/config').expect(200);
    expect(config.body.support.hours).toBe('8am–10pm');

    // Step 4: the change, and the earlier CLI row for topup.account.
    const page = await http().get('/api/v1/audit-logs').query({ action: 'setting.update' }).set(office()).expect(200);
    const items = page.body.items as AuditItem[];
    const change = items.find((item) => item.diff?.key === 'support.hours');
    expect(change).toMatchObject({
      actor: { kind: 'USER', userId: std.SA1.id, name: 'Owner' },
      reason: 'Longer office hours',
      diff: expect.objectContaining({ key: 'support.hours', from: '9am–9pm', to: '8am–10pm' }),
    });
    const cli = items.find((item) => item.diff?.key === 'topup.account');
    expect(cli).toMatchObject({ actor: { kind: 'SYSTEM', label: 'cli:settings' } });
    expect(cli?.actor.userId).toBeUndefined();
    expect(Date.parse(cli!.at)).toBeLessThanOrEqual(Date.parse(change!.at));

    // Step 5.
    await http().patch('/api/v1/settings/support.hours').set(office()).send({ value: '9am–9pm', reason: 'Back to default' }).expect(200);
    expect((await http().get('/api/v1/app/config').expect(200)).body.support.hours).toBe('9am–9pm');
    const rowsAfter = await getTestPrisma().auditLog.findMany({ where: { action: 'setting.update' }, orderBy: { createdAt: 'asc' } });
    const hours = rowsAfter.filter((row) => (row.diff as { key?: string } | null)?.key === 'support.hours');
    expect(hours.map((row) => [row.reason, (row.diff as { to?: unknown }).to])).toEqual([
      ['Longer office hours', '8am–10pm'],
      ['Back to default', '9am–9pm'],
    ]);
  });

  it('OFF-010 the activity log can be filtered and paged past 200 rows', async () => {
    const db = getTestPrisma();
    const day = { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' };
    const today = businessDate(new Date(), day);
    const yesterday = addDays(today, -1);
    const starts = { [yesterday]: businessDayRange(yesterday, day).start, [today]: businessDayRange(today, day).start };
    // Fixture: 250 audit rows for DA over two business days: order.create by DA, every 25th an order.assign by SA1.
    const orderIds: string[] = [];
    const rows = Array.from({ length: 250 }, (_, i) => {
      const date = i < 125 ? yesterday : today;
      const at = new Date(starts[date].getTime() + 60_000 + (i % 125) * 1_000);
      const bySa1 = i % 25 === 0;
      const resourceId = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
      if (!bySa1) orderIds.push(resourceId);
      return {
        actorKind: 'USER' as const,
        actorUserId: bySa1 ? std.SA1.id : std.DA.userId,
        action: bySa1 ? 'order.assign' : 'order.create',
        resourceType: 'order',
        resourceId,
        distributorId: std.DA.id,
        diff: { no: `AG-${String(i + 1).padStart(4, '0')}` },
        createdAt: at,
      };
    });
    await db.auditLog.createMany({ data: rows });
    const sa1Rows = rows.filter((row) => row.actorUserId === std.SA1.id).length;
    expect(sa1Rows).toBeGreaterThan(0);

    // Step 1: every DA row across pages of 100, newest first, no repeats, no 200-row cap.
    const seen: AuditItem[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await http()
        .get('/api/v1/audit-logs')
        .query({ distributorId: std.DA.id, limit: 100, ...(cursor ? { cursor } : {}) })
        .set(office())
        .expect(200);
      seen.push(...(res.body.items as AuditItem[]));
      cursor = res.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(250);
    expect(new Set(seen.map((item) => item.id)).size).toBe(250);
    const times = seen.map((item) => Date.parse(item.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const item of seen.slice(0, 3)) {
      expect(Object.keys(item).sort()).toEqual(['action', 'actor', 'at', 'diff', 'distributorId', 'id', 'reason', 'resourceId', 'resourceType']);
    }

    // Step 2: one action on one record.
    const one = await http().get('/api/v1/audit-logs').query({ action: 'order.create', resourceId: orderIds[7] }).set(office()).expect(200);
    expect(one.body.items).toHaveLength(1);
    expect(one.body.items[0]).toMatchObject({ action: 'order.create', resourceId: orderIds[7], distributorId: std.DA.id });

    // Step 3: one person's rows, then one business day.
    const bySa1 = await http().get('/api/v1/audit-logs').query({ actorUserId: std.SA1.id, limit: 100 }).set(office()).expect(200);
    const sa1Items = bySa1.body.items as AuditItem[];
    expect(sa1Items).toHaveLength(sa1Rows);
    expect(sa1Items.every((item) => item.actor.userId === std.SA1.id)).toBe(true);
    const dayItems: AuditItem[] = [];
    cursor = undefined;
    do {
      const res = await http()
        .get('/api/v1/audit-logs')
        .query({ from: yesterday, to: yesterday, limit: 100, ...(cursor ? { cursor } : {}) })
        .set(office())
        .expect(200);
      dayItems.push(...(res.body.items as AuditItem[]));
      cursor = res.body.nextCursor ?? undefined;
    } while (cursor);
    expect(dayItems).toHaveLength(125);
    const { start, end } = businessDayRange(yesterday, day);
    expect(dayItems.every((item) => Date.parse(item.at) >= start.getTime() && Date.parse(item.at) < end.getTime())).toBe(true);

    // Step 4: the CLI row names the system, with no user.
    const settings = await http().get('/api/v1/audit-logs').query({ action: 'setting.update' }).set(office()).expect(200);
    const cli = (settings.body.items as AuditItem[]).find((item) => item.actor.kind === 'SYSTEM');
    expect(cli).toMatchObject({ actor: { kind: 'SYSTEM', label: 'cli:settings' }, diff: expect.objectContaining({ key: 'topup.account' }) });
    expect(cli?.actor.userId).toBeUndefined();

    // Step 5: the shop is refused.
    const shop = await http().get('/api/v1/audit-logs').set(authHeader(std.DA.actor)).expect(403);
    expect(shop.body.code).toBe('PERMISSION_DENIED');
  });
});
