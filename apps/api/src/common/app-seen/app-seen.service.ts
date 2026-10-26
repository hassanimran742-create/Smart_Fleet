import { Injectable, Logger } from '@nestjs/common';
import type { AppSeenDto, AppStatus } from '@smartfleet/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { compareVersions } from '../context/request-context';

/** The two phone apps whose calls are recorded (API_CONTRACT §8.5 step 10). */
export type PhoneApp = 'driver' | 'distributor';

/** How often an app that stays the same is written again for one user, per API process (its `app_seen_at`). */
export const APP_SEEN_REFRESH_MS = 10 * 60_000;
/** Bound on the per-process memory of what was written; the oldest entry is dropped first. */
const MAX_REMEMBERED_USERS = 5_000;

/** The `users` columns the office's views read (DATA_MODEL §5.6). */
export interface AppSeenRow {
  appVariant: string | null;
  appVersion: string | null;
  appSeenAt: Date | null;
}

/**
 * The office's view of a user's app (API_CONTRACT §1.4 `AppStatus`): the version their latest signed-in call
 * came from against `app.minVersion.<app>` now. UP_TO_DATE at or above it, NEEDS_UPDATE below it, NOT_SEEN
 * while no call has been recorded (the release that records them came after it, or the person never signed in).
 */
export function appSeenView(row: AppSeenRow, minVersion: string): AppSeenDto {
  if (!row.appVersion || !row.appSeenAt) return { status: 'NOT_SEEN', version: null, seenAt: null };
  const status: AppStatus = compareVersions(row.appVersion, minVersion) < 0 ? 'NEEDS_UPDATE' : 'UP_TO_DATE';
  return { status, version: row.appVersion, seenAt: row.appSeenAt.toISOString() };
}

/**
 * Which app each shop and driver last used (API_CONTRACT §8.5 step 10, DATA_MODEL §5.6). The update gate
 * (AppVersionInterceptor) hands every signed-in shop or driver call here, refused or not, with the version it
 * read: `X-App-Version`, or "0.1.0" for the installed 0.1.0 JS, which sends no header. The office's Drivers
 * and Distributors lists then show "App: up to date" or "App: needs update" against `app.minVersion`, so the
 * switch-over checks every pilot phone with one look at the website instead of opening Help on each.
 *
 * The write is `users.app_variant`, `app_version` and `app_seen_at`, by raw SQL so `updated_at` keeps meaning
 * a change to the user. It happens when the app or its version changes, and otherwise at most every
 * {@link APP_SEEN_REFRESH_MS} per user and process, so a phone's polling costs one small UPDATE in ten
 * minutes. It never fails the call: a failed write is logged and tried again on the user's next call.
 */
@Injectable()
export class AppSeenService {
  private readonly logger = new Logger('AppSeen');
  /** userId → what this process last wrote, and when. */
  private readonly written = new Map<string, { app: string; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Records a signed-in call of `app` at `version` by `userId` (see the class comment). Never throws. */
  async record(userId: string, app: PhoneApp, version: string, now: number = Date.now()): Promise<void> {
    const key = `${app} ${version}`;
    const last = this.written.get(userId);
    if (last && last.app === key && now - last.at < APP_SEEN_REFRESH_MS) return;
    // Remembered before the write, so the phone's other calls meanwhile don't write it again.
    this.remember(userId, key, now);
    try {
      await this.prisma.$executeRaw`
        UPDATE users SET app_variant = ${app}, app_version = ${version}, app_seen_at = (now() AT TIME ZONE 'UTC')
        WHERE id = ${userId}::uuid`;
    } catch (error) {
      if (this.written.get(userId)?.at === now) this.written.delete(userId);
      this.logger.warn(`Could not record the app of user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The office's views of these users' `app` (one settings read for the list). */
  async viewsOf(app: PhoneApp, rows: readonly AppSeenRow[]): Promise<AppSeenDto[]> {
    if (rows.length === 0) return [];
    const minVersion = await this.settings.get(app === 'driver' ? 'app.minVersion.driver' : 'app.minVersion.distributor');
    return rows.map((row) => appSeenView(row, minVersion));
  }

  /** Forgets what this process wrote (tests; a user's next call writes again). */
  forgetAll(): void {
    this.written.clear();
  }

  private remember(userId: string, app: string, at: number): void {
    this.written.delete(userId);
    if (this.written.size >= MAX_REMEMBERED_USERS) {
      const oldest = this.written.keys().next();
      if (!oldest.done) this.written.delete(oldest.value);
    }
    this.written.set(userId, { app, at });
  }
}
