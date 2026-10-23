/**
 * [Inc 2] Customer confirmation links (docs/pilot/CUSTOMER_PAGE.md): the link token as the service
 * derives it, a `delivery_confirmations` row with a known token, and calls to the public page and to the
 * shop/office confirmation and case routes (API_CONTRACT §9.6-§9.7).
 *
 *   const conf = await createConfirmation({ order });            // PENDING, expires in 72 h
 *   const links = customerLinks(app);
 *   await links.open(conf.token).expect(200);                    // opening records nothing
 *   const res = await links.answer(conf.token, 'NO', 'Nothing came').expect(303);
 *   const shared = await links.share(std.DA, order.id, 'COPY').expect(200);
 *   const token = tokenFromUrl(shared.body.url);
 *
 * The token rules are the service's own (`deriveConfirmationToken`, `confirmationTokenHash` in
 * src/modules/confirmation/confirmation.interface.ts), so a fixture row opens with the real page.
 * CONFIRM_LINK_SECRET defaults to a test-only value when the environment has none.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfirmationResponse, ConfirmationStatus, Prisma, PrismaClient } from '@prisma/client';
import type { ConfirmationShareVia, ConfirmationSnapshot } from '@smartfleet/shared-types';
import {
  confirmationTokenHash,
  deriveConfirmationToken,
  normalizeConfirmationToken,
} from '../../src/modules/confirmation/confirmation.interface';
import { authHeader, type TestActor } from './auth';
import { getTestPrisma } from './db';
import { http, type TestRequest } from './http';
import type { TestOrder } from './runs';

type Db = PrismaClient | Prisma.TransactionClient;

/** The link secret tests sign with when CONFIRM_LINK_SECRET isn't set (at least 32 characters, never a deployment's). */
export const TEST_CONFIRM_LINK_SECRET = 'test_only_confirm_link_secret_not_for_any_deployment';
// The API under test reads the same variable, so a fixture's token opens the real page.
process.env.CONFIRM_LINK_SECRET ??= TEST_CONFIRM_LINK_SECRET;

/** The secret links are signed with in this run. */
export function linkSecret(): string {
  return process.env.CONFIRM_LINK_SECRET ?? TEST_CONFIRM_LINK_SECRET;
}

/** The token of a confirmation's link version (CUSTOMER_PAGE §2). */
export function confirmationToken(confirmationId: string, tokenVersion = 1): string {
  return deriveConfirmationToken(linkSecret(), confirmationId, tokenVersion);
}

/** The public path of a token: `/c/<token>` (outside `/api/v1`). */
export function customerLinkPath(token: string): string {
  return `/c/${token}`;
}

/** The token in a share answer's `url` (`https://<link host>/c/<token>`), normalised. */
export function tokenFromUrl(url: string): string {
  const match = /\/c\/([^/?#]+)/.exec(url);
  const token = match ? normalizeConfirmationToken(decodeURIComponent(match[1])) : null;
  if (!token) throw new Error(`no confirmation token in ${url}`);
  return token;
}

export interface TestConfirmation {
  id: string;
  orderId: string;
  tokenVersion: number;
  /** The current link token (only its hash is stored). */
  token: string;
  tokenHash: string;
  /** `/c/<token>`. */
  path: string;
  expiresAt: Date;
}

/**
 * A `delivery_confirmations` row for a delivered order, with a token derived like the service's. By
 * default PENDING, delivered now, expiring after 72 hours, the customer's phone from the order, and a
 * snapshot naming the shop and the order with empty lists. `response` makes it ANSWERED.
 */
export async function createConfirmation(
  opts: {
    order: Pick<TestOrder, 'id' | 'shortCode' | 'distributorId' | 'clientId'>;
    deliveredAt?: Date;
    ttlHours?: number;
    expiresAt?: Date;
    status?: ConfirmationStatus;
    response?: ConfirmationResponse;
    comment?: string | null;
    /** Default the customer's phone when it is a Pakistani mobile, else null. */
    phoneE164?: string | null;
    tokenVersion?: number;
    snapshot?: Partial<ConfirmationSnapshot>;
  },
  db: Db = getTestPrisma(),
): Promise<TestConfirmation> {
  const id = randomUUID();
  const tokenVersion = opts.tokenVersion ?? 1;
  const token = confirmationToken(id, tokenVersion);
  const deliveredAt = opts.deliveredAt ?? new Date();
  const expiresAt = opts.expiresAt ?? new Date(deliveredAt.getTime() + (opts.ttlHours ?? 72) * 3_600_000);
  const shop = await db.distributor.findUniqueOrThrow({
    where: { id: opts.order.distributorId },
    select: { businessName: true, user: { select: { phone: true } } },
  });
  const client = await db.client.findUniqueOrThrow({ where: { id: opts.order.clientId }, select: { phone: true } });
  const phone = opts.phoneE164 !== undefined ? opts.phoneE164 : /^\+923[0-9]{9}$/.test(client.phone) ? client.phone : null;
  const snapshot: ConfirmationSnapshot = {
    v: 1,
    shop: { name: shop.businessName, phoneE164: shop.user.phone },
    orderNo: opts.order.shortCode,
    deliveredAt: deliveredAt.toISOString(),
    delivered: [],
    takenBack: [],
    ...opts.snapshot,
  };
  const status = opts.status ?? (opts.response ? ConfirmationStatus.ANSWERED : ConfirmationStatus.PENDING);
  await db.deliveryConfirmation.create({
    data: {
      id,
      orderId: opts.order.id,
      distributorId: opts.order.distributorId,
      tokenHash: confirmationTokenHash(token),
      tokenVersion,
      status,
      expiresAt,
      phoneE164: phone,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      response: opts.response ?? null,
      comment: opts.comment ?? null,
      respondedAt: opts.response ? new Date() : null,
    },
  });
  return { id, orderId: opts.order.id, tokenVersion, token, tokenHash: confirmationTokenHash(token), path: customerLinkPath(token), expiresAt };
}

type Caller = { actor: TestActor } | TestActor;
const headers = (caller: Caller) => authHeader('actor' in caller ? caller.actor : caller);

/** Calls to the public page and the confirmation and case routes. */
export function customerLinks(app: INestApplication) {
  const api = http(app);
  const withKey = (req: TestRequest, key?: string) => (key ? req.set('Idempotency-Key', key) : req);
  return {
    /** `GET /c/:token` (or a second-step page: `open(token, '/partly')`). Opening records nothing. */
    open(token: string, page = ''): TestRequest {
      return api.get(`${customerLinkPath(token)}${page}`);
    },
    /** `POST /c/:token` as the page's form sends it (`application/x-www-form-urlencoded`, `v=1`). */
    answer(token: string, answer: string, comment?: string): TestRequest {
      const form = new URLSearchParams({ v: '1', answer });
      if (comment !== undefined) form.set('comment', comment);
      return api.post(customerLinkPath(token)).set('Content-Type', 'application/x-www-form-urlencoded').send(form.toString());
    },
    /** `GET /orders/:id/confirmation` (`ConfirmationView`). */
    view(caller: Caller, orderId: string): TestRequest {
      return api.get(`/api/v1/orders/${orderId}/confirmation`).set(headers(caller));
    },
    /** `POST /orders/:id/confirmation/share` (`ConfirmationShareResult`). */
    share(caller: Caller, orderId: string, via: ConfirmationShareVia, idempotencyKey?: string): TestRequest {
      return withKey(api.post(`/api/v1/orders/${orderId}/confirmation/share`).set(headers(caller)), idempotencyKey).send({ via });
    },
    /** `POST /orders/:id/confirmation/new-link` (`ConfirmationView`). */
    newLink(caller: Caller, orderId: string, body: { send?: 'SMS' } = {}, idempotencyKey?: string): TestRequest {
      return withKey(api.post(`/api/v1/orders/${orderId}/confirmation/new-link`).set(headers(caller)), idempotencyKey).send(body);
    },
    /** `GET /alerts?type=CUSTOMER_PROBLEM&status=…` (office): `Page<CaseDto>`. */
    cases(office: Caller, query: { status?: 'OPEN' | 'RESOLVED'; cursor?: string; limit?: number } = {}): TestRequest {
      return api.get('/api/v1/alerts').set(headers(office)).query({ type: 'CUSTOMER_PROBLEM', ...query });
    },
    /** `GET /alerts/mine` (the shop): its open cases. */
    myCases(shop: Caller): TestRequest {
      return api.get('/api/v1/alerts/mine').set(headers(shop));
    },
    /** `POST /alerts/:id/resolve` (office) `{ note }`. */
    resolveCase(office: Caller, alertId: string, note: string): TestRequest {
      return api.post(`/api/v1/alerts/${alertId}/resolve`).set(headers(office)).send({ note });
    },
  };
}

export type CustomerLinks = ReturnType<typeof customerLinks>;
