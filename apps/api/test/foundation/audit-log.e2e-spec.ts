/**
 * FND-013 and FND-014: audit rows name their actor (a user, the system or a customer), the database
 * enforces it, and a row commits with the change it records or not at all (API_CONTRACT §5.3,
 * DATA_MODEL §3.4 audit_logs_actor_chk).
 */
import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { customerActor, systemActor, userActor } from '../../src/common/auth/actor';
import { RequestContext } from '../../src/common/context/request-context';
import { AuditLogService, type AuditEvent } from '../../src/modules/audit-log/audit-log.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';

describeDb('foundation: the audit log', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  const http = () => client(app);

  function threeEvents(): AuditEvent[] {
    return [
      {
        action: 'setting.update',
        actor: userActor({ userId: std.SA1.id, role: UserRole.SUPER_ADMIN }),
        resourceType: 'setting',
        reason: 'Audit actor test',
        diff: { key: 'support.hours', from: '9am–9pm', to: '9am–9pm' },
      },
      { action: 'wallet.check', actor: systemActor('job:wallet-check'), resourceType: 'Wallet', diff: { mismatches: 0 } },
      { action: 'confirmation.answer', actor: customerActor('link:AG-0001'), resourceType: 'Order', diff: { answer: 'YES' } },
    ];
  }

  it('FND-013 audit rows record the actor as a user, the system or a customer, and the database enforces it', async () => {
    const audit = app.get(AuditLogService);
    const db = getTestPrisma();

    // Step 1.
    for (const event of threeEvents()) await audit.record(event);
    const rows = await db.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => [row.actorKind, row.actorUserId, row.actorLabel])).toEqual([
      ['USER', std.SA1.id, null],
      ['SYSTEM', null, 'job:wallet-check'],
      ['CUSTOMER', null, 'link:AG-0001'],
    ]);

    // Step 2: the CHECK refuses every mismatch of kind and user.
    const insert = (kind: string, userId: string | null) =>
      db.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, actor_kind, actor_user_id, actor_label, action, resource_type, created_at)
         VALUES (gen_random_uuid(), $1::"AuditActorKind", $2::uuid, 'raw insert', 'setting.update', 'setting', now())`,
        kind,
        userId,
      );
    for (const [kind, userId] of [
      ['USER', null],
      ['SYSTEM', std.SA1.id],
      ['CUSTOMER', std.SA1.id],
    ] as const) {
      const error = await insert(kind, userId).then(
        () => null,
        (e: unknown) => e as { code?: string; meta?: { code?: string; message?: string }; message: string },
      );
      expect(error).not.toBeNull();
      const text = `${error?.meta?.code ?? ''} ${error?.meta?.message ?? ''} ${error?.message ?? ''}`;
      expect(text).toContain('23514');
      expect(text).toContain('audit_logs_actor_chk');
    }
    expect(await db.auditLog.count()).toBe(3);

    // Step 3.
    const listed = await http().get('/api/v1/audit-logs').set(authHeader(std.SA1.actor)).expect(200);
    const actors = (listed.body.items as Array<{ action: string; actor: Record<string, unknown> }>).map((item) => item.actor);
    expect(actors).toEqual(
      expect.arrayContaining([
        { kind: 'USER', userId: std.SA1.id, name: 'Owner' },
        { kind: 'SYSTEM', label: 'job:wallet-check' },
        { kind: 'CUSTOMER', label: 'link:AG-0001' },
      ]),
    );

    // Step 4: inside a request, users and the system keep the IP and user agent; a customer never does.
    await db.auditLog.deleteMany();
    await RequestContext.run({ requestId: 'req-fnd-013', ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Android)' }, async () => {
      for (const event of threeEvents()) await audit.record(event);
    });
    const inRequest = await db.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(inRequest.map((row) => [row.actorKind, row.ip, row.userAgent, row.requestId])).toEqual([
      ['USER', '203.0.113.9', 'Mozilla/5.0 (Android)', 'req-fnd-013'],
      ['SYSTEM', '203.0.113.9', 'Mozilla/5.0 (Android)', 'req-fnd-013'],
      ['CUSTOMER', null, null, 'req-fnd-013'],
    ]);
  });

  it('FND-014 an audit row is written in the same transaction as the change it records', async () => {
    const key = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const correction = { direction: 'ADD', amountPaisa: 100000, reasonCode: 'SYSTEM_ERROR', note: 'Audit rollback test, please ignore' };
    const audit = app.get(AuditLogService);
    const real = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (event, tx) => {
      if (event.action === 'wallet.correction') throw new Error('audit write failed');
      return real(event, tx);
    });
    const url = `/api/v1/admin/distributors/${std.DA.id}/wallet/corrections`;
    // Step 1.
    const failed = await http().post(url).set(authHeader(std.SA1.actor)).set('Idempotency-Key', key).send(correction);
    expect(failed.status).toBe(500);
    expect(failed.body.code).toBe('INTERNAL_ERROR');
    // Step 2.
    const wallet = await http().get(`/api/v1/admin/distributors/${std.DA.id}/wallet`).set(authHeader(std.SA1.actor)).expect(200);
    expect(wallet.body.balancePaisa).toBe('500000');
    expect(wallet.body.integrity.ok).toBe(true);
    expect(await getTestPrisma().ledgerEntry.count({ where: { idempotencyKey: `adjust:${key}` } })).toBe(0);
    // Steps 3–4: the failed attempt didn't use up the key.
    spy.mockRestore();
    await http().post(url).set(authHeader(std.SA1.actor)).set('Idempotency-Key', key).send(correction).expect(201);
    const after = await http().get(`/api/v1/admin/distributors/${std.DA.id}/wallet`).set(authHeader(std.SA1.actor)).expect(200);
    expect(after.body.balancePaisa).toBe('600000');
    const entries = await getTestPrisma().ledgerEntry.findMany({ where: { idempotencyKey: `adjust:${key}` } });
    expect(entries).toHaveLength(1);
    expect(entries[0].amountPaisa).toBe(100000n);
    const logs = await http().get('/api/v1/audit-logs').query({ action: 'wallet.correction' }).set(authHeader(std.SA1.actor)).expect(200);
    expect(logs.body.items).toHaveLength(1);
    expect(logs.body.items[0]).toMatchObject({ actor: { kind: 'USER', userId: std.SA1.id }, reason: expect.stringContaining('Audit rollback test') });
    // Step 5.
    await http()
      .post(url)
      .set(authHeader(std.SA1.actor))
      .set('Idempotency-Key', '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e')
      .send({ direction: 'TAKE', amountPaisa: 100000, reasonCode: 'SYSTEM_ERROR', note: 'Undo the audit rollback test' })
      .expect(201);
  });

  it("a record's history matches its resource type in any letter case (the distributor page sees its wallet corrections)", async () => {
    const office = authHeader(std.SA1.actor);
    await http()
      .post(`/api/v1/admin/distributors/${std.DA.id}/wallet/corrections`)
      .set(office)
      .set('Idempotency-Key', '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f')
      .send({ direction: 'ADD', amountPaisa: 10000, reasonCode: 'SYSTEM_ERROR', note: 'Letter case of resource types' })
      .expect(201);
    // The money lane writes 'Distributor'; the website's distributor page asks for 'distributor'.
    for (const resourceType of ['distributor', 'Distributor', 'DISTRIBUTOR']) {
      const page = await http().get('/api/v1/audit-logs').query({ resourceType, resourceId: std.DA.id }).set(office).expect(200);
      const rows = page.body.items as Array<{ action: string; resourceType: string; diff: Record<string, unknown> }>;
      expect({ resourceType, actions: rows.map((row) => row.action) }).toEqual({ resourceType, actions: ['wallet.correction'] });
      expect(rows[0]).toMatchObject({ resourceType: 'Distributor', diff: { distributor: 'Ahmed Gas', direction: 'ADD' } });
    }
  });
});
