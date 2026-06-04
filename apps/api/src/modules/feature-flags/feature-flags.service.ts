import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type PostHogClient = {
  isFeatureEnabled: (
    flag: string,
    distinctId: string,
    options?: any,
  ) => Promise<boolean | undefined>;
  getFeatureFlag: (
    flag: string,
    distinctId: string,
    options?: any,
  ) => Promise<string | boolean | undefined>;
  shutdown: () => Promise<void>;
};

// Thin wrapper over PostHog server SDK. Keeping a wrapper means we can swap
// PostHog for Unleash / LaunchDarkly / etc. by changing one file.
@Injectable()
export class FeatureFlagsService implements OnModuleDestroy {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private client: PostHogClient | null = null;
  private readonly enabled: boolean;

  constructor(cfg: ConfigService) {
    const apiKey = cfg.get<string>('featureFlags.posthogKey') ?? '';
    const host = cfg.get<string>('featureFlags.posthogHost') ?? 'https://app.posthog.com';
    this.enabled = apiKey.length > 0;

    if (this.enabled) {
      try {
        const { PostHog } = require('posthog-node');
        this.client = new PostHog(apiKey, { host });
      } catch (e) {
        this.logger.warn(
          'posthog-node not installed; feature flags will default to "off". Run `npm i posthog-node` in apps/api.',
        );
        this.client = null;
      }
    }
  }

  async isEnabled(flag: string, userId: string, fallback = false): Promise<boolean> {
    if (!this.client) return fallback;
    try {
      const v = await this.client.isFeatureEnabled(flag, userId);
      return v ?? fallback;
    } catch (e) {
      this.logger.warn(`Flag ${flag} eval failed: ${(e as Error).message}`);
      return fallback;
    }
  }

  async getVariant(flag: string, userId: string): Promise<string | boolean | undefined> {
    if (!this.client) return undefined;
    try {
      return await this.client.getFeatureFlag(flag, userId);
    } catch (e) {
      this.logger.warn(`Variant ${flag} eval failed: ${(e as Error).message}`);
      return undefined;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch {
        /* noop */
      }
    }
  }
}
