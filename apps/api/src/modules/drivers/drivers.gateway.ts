import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UserRole } from '@prisma/client';
import type { ErrorCode } from '@smartfleet/shared-types';
import { driverLocationSchema, driverOnlineSchema } from '@smartfleet/shared-validation';
import type { Namespace, Socket } from 'socket.io';
import { AppError } from '../../common/errors/app-error';
import { AccessTokenVerifier } from '../auth/access-token.verifier';
import { SessionCheckService } from '../auth/session-check.service';
import { hasExpired, type TokenClaims } from '../auth/token-claims';
import { DriversService } from './drivers.service';
import { allowSocketRequest, setSocketOrigins, socketCorsOrigin } from './socket-origins';

/** The room of the office's sockets: the only listeners of driver positions (API_CONTRACT §7.14). */
export const OFFICE_ROOM = 'office';
export const driverRoom = (driverId: string): string => `driver:${driverId}`;
/** A driver's position and online state are stored and broadcast at most once per 5 seconds. */
export const DRIVER_UPDATE_INTERVAL_MS = 5_000;
/**
 * How often every office socket's session is checked again, for sessions ended outside this process
 * (a session ends within 60 seconds, API_CONTRACT §3.3; the session check caches for 60).
 */
export const OFFICE_RECHECK_MS = 30_000;
/** setTimeout's longest wait (about 24.8 days); a token that lives longer is waited for in steps. */
const MAX_TIMER_MS = 2_147_483_647;

type SocketRefusal = Extract<ErrorCode, 'AUTH_TOKEN_INVALID' | 'AUTH_SESSION_REVOKED' | 'PERMISSION_DENIED'>;

/** What the connection check leaves on `socket.data`. */
interface DriverSocketData {
  claims?: TokenClaims;
  refusal?: SocketRefusal;
  /** A driver's name, for the office's `driver:location` events. */
  name?: string;
  /** Drops an office socket when its access token expires. */
  expiryTimer?: NodeJS.Timeout;
}

/** An early `online:set`, applied when the driver's window ends, if the socket's session is still live. */
interface PendingOnline {
  isOnline: boolean;
  timer: NodeJS.Timeout;
  socket: Socket;
}

/** The answer (acknowledgement) to a driver's `location:update` or `online:set`. */
export type SocketAck = { ok: true } | { ok: false; code: ErrorCode };

/** At most one accepted update per key per interval; the first one in a window wins. */
export class UpdateThrottle {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 0 when `key` may update now (the slot is taken); else the milliseconds until it may. */
  take(key: string): number {
    const now = this.now();
    const last = this.last.get(key);
    if (last !== undefined && now - last < this.intervalMs) return this.intervalMs - (now - last);
    this.last.set(key, now);
    if (this.last.size > 10_000) {
      for (const [k, at] of this.last) if (now - at >= this.intervalMs) this.last.delete(k);
    }
    return 0;
  }
}

/**
 * The `/drivers` socket (API_CONTRACT §7.14).
 * - The handshake's `auth.token` is checked before the socket joins: signature and expiry, then the
 *   session (ACTIVE, role not locked, `tv` current). Only DRIVER and SUPER_ADMIN may stay. Any other
 *   caller is sent `error { code }` (AUTH_TOKEN_INVALID, AUTH_SESSION_REVOKED or PERMISSION_DENIED)
 *   and disconnected; browser origins outside CORS_ORIGINS are refused at the handshake.
 * - A driver joins `driver:<id>`; the office joins `office` and gets `drivers:snapshot`.
 * - `location:update` and `online:set` are the driver's own: the driver id comes from the token and
 *   any id in the payload is ignored. Each is stored at most once per 5 seconds; an `online:set` that
 *   arrives too soon is applied when the window ends, so the last state is never lost, unless the
 *   session ended meanwhile (an archive, a suspension): then it is dropped.
 * - A driver's socket is checked again (session and expiry) on every message it sends. An office
 *   socket, which hears every driver, is dropped when its access token expires, at once when a change
 *   through this API ends its user's session (`SessionCheckService.forget`), and otherwise by a check
 *   every 30 seconds; each gets `error { code }` first (AUTH_TOKEN_INVALID or AUTH_SESSION_REVOKED).
 * - Positions and online changes are broadcast to `office` only.
 */
@WebSocketGateway({
  namespace: '/drivers',
  cors: { origin: socketCorsOrigin },
  allowRequest: allowSocketRequest,
})
export class DriversGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(DriversGateway.name);
  private readonly locationThrottle = new UpdateThrottle(DRIVER_UPDATE_INTERVAL_MS);
  private readonly onlineThrottle = new UpdateThrottle(DRIVER_UPDATE_INTERVAL_MS);
  private readonly pendingOnline = new Map<string, PendingOnline>();
  private officeRecheck: NodeJS.Timeout | null = null;
  private stopListening: (() => void) | null = null;

  constructor(
    private readonly drivers: DriversService,
    private readonly tokens: AccessTokenVerifier,
    private readonly sessions: SessionCheckService,
    config: ConfigService,
  ) {
    setSocketOrigins(config.get<string[]>('cors.origins') ?? []);
  }

  /**
   * Checks every handshake before the socket joins, so no message is handled for an unchecked socket.
   * Then keeps checking the open sockets: a session ended through this API drops its user's sockets
   * at once, and the office's sockets are checked again every 30 seconds.
   */
  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      void this.authenticate(socket).finally(() => next());
    });
    this.stopListening = this.sessions.onForget((userId) => void this.recheckUser(userId));
    this.officeRecheck = setInterval(() => void this.recheckOffice(), OFFICE_RECHECK_MS);
    this.officeRecheck.unref?.();
  }

  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as DriverSocketData;
    const claims = data.claims;
    if (!claims) return this.refuse(socket, data.refusal ?? 'AUTH_TOKEN_INVALID');
    if (claims.role === UserRole.DRIVER && claims.driverId) {
      await socket.join(driverRoom(claims.driverId));
      return;
    }
    await socket.join(OFFICE_ROOM);
    // The office hears every driver's position, so its socket never outlives its access token.
    this.watchExpiry(socket);
    if (!socket.connected) return;
    try {
      socket.emit('drivers:snapshot', await this.drivers.liveSnapshot());
    } catch (error) {
      // The office still gets every live update; only the starting picture is missing.
      this.logger.warn(`drivers socket: the office snapshot failed (${(error as Error)?.message ?? String(error)})`);
    }
  }

  @SubscribeMessage('location:update')
  async onLocation(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<SocketAck> {
    const driverId = await this.driverOf(socket);
    if (!driverId) return { ok: false, code: 'PERMISSION_DENIED' };
    const parsed = driverLocationSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: 'VALIDATION_FAILED' };
    if (this.locationThrottle.take(driverId) > 0) return { ok: false, code: 'RATE_LIMITED' };
    try {
      await this.drivers.applyLocation(driverId, parsed.data.lat, parsed.data.lng);
    } catch (error) {
      return { ok: false, code: this.codeOf(error) };
    }
    const name = (socket.data as DriverSocketData).name;
    this.server.to(OFFICE_ROOM).emit('driver:location', {
      driverId,
      ...(name ? { name } : {}),
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  @SubscribeMessage('online:set')
  async onOnline(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<SocketAck> {
    const driverId = await this.driverOf(socket);
    if (!driverId) return { ok: false, code: 'PERMISSION_DENIED' };
    const parsed = driverOnlineSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: 'VALIDATION_FAILED' };
    const wait = this.onlineThrottle.take(driverId);
    if (wait > 0) {
      this.deferOnline(socket, driverId, parsed.data.isOnline, wait);
      return { ok: true };
    }
    try {
      await this.applyOnline(driverId, parsed.data.isOnline);
      return { ok: true };
    } catch (error) {
      return { ok: false, code: this.codeOf(error) };
    }
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as DriverSocketData;
    if (data.expiryTimer) clearTimeout(data.expiryTimer);
    data.expiryTimer = undefined;
  }

  onModuleDestroy(): void {
    for (const pending of this.pendingOnline.values()) clearTimeout(pending.timer);
    this.pendingOnline.clear();
    if (this.officeRecheck) clearInterval(this.officeRecheck);
    this.officeRecheck = null;
    this.stopListening?.();
    this.stopListening = null;
    for (const socket of this.openSockets()) this.handleDisconnect(socket);
  }

  // ---------- internals ----------

  private async authenticate(socket: Socket): Promise<void> {
    const data = socket.data as DriverSocketData;
    try {
      const auth = socket.handshake.auth as { token?: unknown } | undefined;
      const claims = await this.tokens.verify(auth?.token);
      const isDriver = claims.role === UserRole.DRIVER && !!claims.driverId;
      if (!isDriver && claims.role !== UserRole.SUPER_ADMIN) {
        data.refusal = 'PERMISSION_DENIED';
        return;
      }
      data.claims = claims;
      if (isDriver) data.name = (await this.drivers.nameOf(claims.driverId as string)) ?? undefined;
    } catch (error) {
      data.refusal = AppError.is(error, 'AUTH_SESSION_REVOKED') ? 'AUTH_SESSION_REVOKED' : 'AUTH_TOKEN_INVALID';
    }
  }

  /**
   * The driver id of a driver's socket whose token is unexpired and whose session is still live;
   * otherwise the socket is dropped (AUTH_TOKEN_INVALID or AUTH_SESSION_REVOKED).
   */
  private async driverOf(socket: Socket): Promise<string | null> {
    const claims = (socket.data as DriverSocketData).claims;
    if (!claims || claims.role !== UserRole.DRIVER || !claims.driverId) return null;
    return (await this.stillLive(socket, claims, true)) ? claims.driverId : null;
  }

  /**
   * Checks an open socket's token again: expired is AUTH_TOKEN_INVALID, an ended session (§3.3)
   * AUTH_SESSION_REVOKED, and either drops the socket. Any other failure of the check (the database
   * is down) drops it only when `strict`; the office's re-checks keep it and try again later.
   */
  private async stillLive(socket: Socket, claims: TokenClaims, strict: boolean): Promise<boolean> {
    if (hasExpired(claims)) {
      this.refuse(socket, 'AUTH_TOKEN_INVALID');
      return false;
    }
    try {
      await this.sessions.assertLive(claims);
      return true;
    } catch (error) {
      if (strict || AppError.is(error, 'AUTH_SESSION_REVOKED')) {
        this.refuse(socket, 'AUTH_SESSION_REVOKED');
        return false;
      }
      this.logger.warn(`drivers socket: a session re-check failed (${(error as Error)?.message ?? String(error)})`);
      return true;
    }
  }

  /** Drops an office socket when its token expires (rescheduled in steps for a very long-lived token). */
  private watchExpiry(socket: Socket): void {
    const data = socket.data as DriverSocketData;
    if (data.expiryTimer) clearTimeout(data.expiryTimer);
    data.expiryTimer = undefined;
    const exp = data.claims?.exp;
    if (exp === undefined || !socket.connected) return;
    const left = exp * 1000 - Date.now();
    if (left <= 0) return this.refuse(socket, 'AUTH_TOKEN_INVALID');
    data.expiryTimer = setTimeout(() => this.watchExpiry(socket), Math.min(left, MAX_TIMER_MS));
    data.expiryTimer.unref?.();
  }

  /** Re-checks every open socket of one user, right after a change to their session. */
  private async recheckUser(userId: string): Promise<void> {
    try {
      const sockets = this.openSockets().filter((socket) => (socket.data as DriverSocketData).claims?.sub === userId);
      await Promise.all(sockets.map((socket) => this.stillLive(socket, (socket.data as DriverSocketData).claims as TokenClaims, false)));
    } catch (error) {
      this.logger.warn(`drivers socket: re-checking a user's sockets failed (${(error as Error)?.message ?? String(error)})`);
    }
  }

  /** Re-checks every office socket: its session may have ended outside this process. */
  private async recheckOffice(): Promise<void> {
    try {
      for (const socket of this.openSockets()) {
        const claims = (socket.data as DriverSocketData).claims;
        if (claims && socket.rooms.has(OFFICE_ROOM)) await this.stillLive(socket, claims, false);
      }
    } catch (error) {
      this.logger.warn(`drivers socket: re-checking the office sockets failed (${(error as Error)?.message ?? String(error)})`);
    }
  }

  /** This namespace's connected sockets (none before the gateway is initialised). */
  private openSockets(): Socket[] {
    const sockets = (this.server as Namespace | undefined)?.sockets;
    return sockets ? [...sockets.values()] : [];
  }

  private refuse(socket: Socket, code: SocketRefusal): void {
    socket.emit('error', { code });
    socket.disconnect(true);
  }

  private async applyOnline(driverId: string, isOnline: boolean): Promise<void> {
    await this.drivers.applyOnline(driverId, isOnline);
    this.server.to(OFFICE_ROOM).emit('driver:online', { driverId, isOnline });
  }

  /** Keeps only the latest early `online:set` and applies it when the driver's window ends. */
  private deferOnline(socket: Socket, driverId: string, isOnline: boolean, waitMs: number): void {
    const pending = this.pendingOnline.get(driverId);
    if (pending) {
      pending.isOnline = isOnline;
      pending.socket = socket;
      return;
    }
    const timer = setTimeout(() => void this.flushOnline(driverId), waitMs);
    timer.unref?.();
    this.pendingOnline.set(driverId, { isOnline, timer, socket });
  }

  private async flushOnline(driverId: string): Promise<void> {
    const pending = this.pendingOnline.get(driverId);
    this.pendingOnline.delete(driverId);
    if (!pending) return;
    this.onlineThrottle.take(driverId);
    // The session may have ended while the change waited (an archive, a suspension): drop it then.
    if ((await this.driverOf(pending.socket)) !== driverId) return;
    try {
      await this.applyOnline(driverId, pending.isOnline);
    } catch (error) {
      this.logger.warn(`drivers socket: a deferred online:set failed (${this.codeOf(error)})`);
    }
  }

  private codeOf(error: unknown): ErrorCode {
    if (error instanceof AppError) return error.code;
    this.logger.error(`drivers socket update failed: ${(error as Error)?.stack ?? String(error)}`);
    return 'INTERNAL_ERROR';
  }
}
