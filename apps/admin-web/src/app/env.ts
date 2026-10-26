import { APP_ENVIRONMENTS, type AppEnvironment } from '@smartfleet/shared-types';

/**
 * Which server this build talks to, for the environment strip and the "[TEST]" tab prefix
 * (UX_ADMIN §2.10). `VITE_APP_ENV` names it at build time: `live` (or `production`), `training`, or
 * `test` (`staging` and `development` count as test). Without it, a dev server is test and a production
 * build is live, so a live build is never labelled "not real money" by mistake.
 */
export type EnvKind = 'live' | 'training' | 'test';

function readBuildEnv(): string | undefined {
  const raw: unknown = import.meta.env.VITE_APP_ENV;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : undefined;
}

export function envKindOf(value: string | undefined | null): EnvKind | undefined {
  switch (value) {
    case 'live':
    case 'production':
    case 'prod':
      return 'live';
    case 'training':
      return 'training';
    case 'test':
    case 'staging':
    case 'development':
    case 'dev':
      return 'test';
    default:
      return undefined;
  }
}

/**
 * The environment of this build. `serverEnvironment` (`GET /app/config` → `environment`) is used only
 * when the build doesn't say.
 */
export function resolveEnvKind(serverEnvironment?: AppEnvironment | null): EnvKind {
  return (
    envKindOf(readBuildEnv()) ?? envKindOf(serverEnvironment ?? undefined) ?? (import.meta.env.DEV ? 'test' : 'live')
  );
}

/** The `APP_ENV` name this build was made for, or the dev/production default when it doesn't say. */
export function buildEnvironment(): AppEnvironment {
  const kind = envKindOf(readBuildEnv());
  if (kind === 'live') return 'production';
  if (kind === 'training') return 'training';
  if (kind === 'test') return 'test';
  return import.meta.env.DEV ? 'development' : 'production';
}

const SERVER_ENV_KEY = 'smartfleet.admin.serverEnvironment';

/** The server's environment from an earlier visit (`/app/config`), or null. */
export function rememberedEnvironment(): AppEnvironment | null {
  try {
    const saved = window.localStorage.getItem(SERVER_ENV_KEY);
    return (APP_ENVIRONMENTS as readonly string[]).includes(saved ?? '') ? (saved as AppEnvironment) : null;
  } catch {
    return null;
  }
}

/** Remembers the server's environment, so the next visit shows the right strip from its first paint. */
export function rememberEnvironment(environment: AppEnvironment): void {
  try {
    if (window.localStorage.getItem(SERVER_ENV_KEY) !== environment) window.localStorage.setItem(SERVER_ENV_KEY, environment);
  } catch {
    // Storage unavailable: the strip waits for /app/config.
  }
}

/**
 * The `APP_ENV` name assumed before `/app/config` answers, or while it can't (website spec §1.1 item 7):
 * the build's own setting, else the server's answer remembered from an earlier visit. The environment
 * strip then keeps its place while loading and doesn't disappear when the server is down.
 */
export function startingEnvironment(): AppEnvironment {
  if (envKindOf(readBuildEnv())) return buildEnvironment();
  return rememberedEnvironment() ?? buildEnvironment();
}
