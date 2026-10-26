/**
 * Helpers for the api-security DB suites (apps/api/test/security). They add to test/helpers, which
 * belongs to the foundation: passwords, sign-in, a per-suite rate-limit store, the session cache and
 * a socket.io client for the `/drivers` namespace.
 */
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'net';
import * as argon2 from 'argon2';
import { io, type Socket } from 'socket.io-client';
import { RateLimitService, type RateLimitStore } from '../../src/common/rate-limit/rate-limit.service';
import { SessionCheckService } from '../../src/modules/auth/session-check.service';
import { getTestPrisma } from '../helpers/db';
import { http, type TestRequest } from '../helpers/http';

/** Booting AppModule compiles and connects everything; on a busy machine that takes minutes. */
export const APP_BOOT_TIMEOUT_MS = 300_000;

/** The default timeout of a test in these suites (sign-ins verify argon2 hashes, which is slow by design). */
export const TEST_TIMEOUT_MS = 120_000;

/** The six keys a response may never carry, at any depth (API_CONTRACT §3.5). */
export const SECRET_KEYS = ['passwordHash', 'cnic', 'cnicEncrypted', 'cnicIndex', 'codeHash', 'tokenHash'] as const;

/** The CNIC-like values the crawler refuses: 13 digits, or 5-7-1 digits with dashes. */
const CNIC_DIGITS = /^\d{13}$/;
const CNIC_DASHED = /(^|[^\d])\d{5}-\d{7}-\d([^\d]|$)/;

/** Every secret key or CNIC-like value in a JSON body, as "path: problem". */
export function secretsIn(body: unknown, path = '$'): string[] {
  if (body === null || body === undefined) return [];
  if (typeof body === 'string') {
    return CNIC_DIGITS.test(body) || CNIC_DASHED.test(body) ? [`${path}: CNIC-like value`] : [];
  }
  if (Array.isArray(body)) return body.flatMap((item, i) => secretsIn(item, `${path}[${i}]`));
  if (typeof body === 'object') {
    return Object.entries(body as Record<string, unknown>).flatMap(([key, value]) => [
      ...((SECRET_KEYS as readonly string[]).includes(key) ? [`${path}.${key}: secret key`] : []),
      ...secretsIn(value, `${path}.${key}`),
    ]);
  }
  return [];
}

const hashes = new Map<string, Promise<string>>();

/** Gives a user an app password (argon2, as the API stores it; one hash per password per suite). */
export async function setPassword(userId: string, password: string): Promise<void> {
  if (!hashes.has(password)) hashes.set(password, argon2.hash(password));
  await getTestPrisma().user.update({ where: { id: userId }, data: { passwordHash: await hashes.get(password) } });
}

/** `POST /auth/login`, optionally with an `X-App-Variant`. */
export function login(app: INestApplication, phone: string, password: string, variant?: string): TestRequest {
  const req = http(app).post('/api/v1/auth/login');
  return (variant ? req.set('X-App-Variant', variant) : req).send({ phone, password });
}

/** An `OPTIONS` request (a CORS preflight); the typed client in test/helpers/http.ts has no `options`. */
export function preflight(app: INestApplication, url: string): TestRequest {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const supertest = require('supertest') as (server: unknown) => { options(url: string): TestRequest };
  return supertest(app.getHttpServer()).options(url);
}

/** `{ Authorization: 'Bearer …' }`. */
export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Decodes a JWT's payload without checking it (the API checks it). */
export function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Fixed-window counters in memory, so a suite's sign-ins never meet another suite's counters in the
 * shared test Redis. Implements the two scripts RateLimitService runs.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly counts = new Map<string, number>();

  async eval(script: string, _numKeys: number, key: string | number): Promise<unknown> {
    const name = String(key);
    if (script.includes('INCR')) {
      const next = (this.counts.get(name) ?? 0) + 1;
      this.counts.set(name, next);
      return next;
    }
    return this.counts.get(name) ?? 0;
  }

  clear(): void {
    this.counts.clear();
  }
}

/** Gives the app's rate limiter a fresh in-memory store; returns it. */
export function useMemoryRateLimits(app: INestApplication): MemoryRateLimitStore {
  const store = new MemoryRateLimitStore();
  app.get(RateLimitService).useStore(store);
  return store;
}

/** Forgets the API's cached session row of these users (as a change through this API does). */
export function forgetSessions(app: INestApplication, ...userIds: string[]): void {
  const sessions = app.get(SessionCheckService);
  for (const id of userIds) sessions.forget(id);
}

/** Makes `Date.now()` run `ms` ahead for the rest of the test (restore with jest.restoreAllMocks()). */
export function advanceClock(ms: number): void {
  const real = Date.now.bind(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => real() + ms);
}

// ---------- the /drivers socket ----------

/** Starts the app's HTTP server on a free port (once) and returns its base URL. */
export async function listen(app: INestApplication): Promise<string> {
  const server = app.getHttpServer() as { listening?: boolean; address(): AddressInfo | string | null };
  if (!server.listening) await app.listen(0, '127.0.0.1');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

export interface SocketEvents {
  socket: Socket;
  /** Every event the server sent, in order, with its payload. */
  events: Array<{ event: string; payload: unknown }>;
  /** Resolves with the first event named `event` (or rejects after `ms`). */
  next(event: string, ms?: number): Promise<unknown>;
  /** True once the socket was disconnected. */
  closed(): boolean;
}

/**
 * A socket.io client on `/drivers` that records every event. `token: null` sends no `auth.token`.
 * The websocket transport is used, as the apps do.
 */
export function connectDrivers(baseUrl: string, token: string | null, opts: { origin?: string } = {}): SocketEvents {
  const socket = io(`${baseUrl}/drivers`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 5_000,
    auth: token === null ? {} : { token },
    ...(opts.origin ? { extraHeaders: { Origin: opts.origin } } : {}),
  });
  const events: Array<{ event: string; payload: unknown }> = [];
  let disconnected = false;
  socket.onAny((event: string, payload: unknown) => events.push({ event, payload }));
  socket.on('connect', () => events.push({ event: 'connect', payload: null }));
  socket.on('connect_error', (error: Error) => events.push({ event: 'connect_error', payload: error.message }));
  socket.on('disconnect', (reason: string) => {
    disconnected = true;
    events.push({ event: 'disconnect', payload: reason });
  });
  const next = (event: string, ms = 5_000) =>
    new Promise<unknown>((resolve, reject) => {
      const seen = events.find((e) => e.event === event);
      if (seen) return resolve(seen.payload);
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`no "${event}" within ${ms} ms; got ${events.map((e) => e.event).join(', ') || 'nothing'}`));
      }, ms);
      const poll = setInterval(() => {
        const hit = events.find((e) => e.event === event);
        if (hit) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve(hit.payload);
        }
      }, 20);
    });
  return { socket, events, next, closed: () => disconnected };
}

/** Emits with an acknowledgement and resolves with the server's answer. */
export function emitWithAck(socket: Socket, event: string, payload: unknown, ms = 5_000): Promise<unknown> {
  return socket.timeout(ms).emitWithAck(event, payload);
}

/** Waits `ms` milliseconds (for events that must NOT arrive). */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
