/**
 * The API for the api-orders suites, with the real WalletService: every order, cancel and quote rule
 * runs against the money lane's code.
 */
import type { INestApplication } from '@nestjs/common';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';

export async function createOrdersTestApp(): Promise<INestApplication> {
  // createTestApp() already listens on one loopback port for the whole suite.
  return createTestApp();
}

/** Forgets cached settings (after a reset or a direct database change). */
export function freshSettings(app: INestApplication): void {
  app.get(SettingsService).invalidate();
}
