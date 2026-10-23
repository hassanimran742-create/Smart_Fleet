import { redactPath } from '../http/redact';

type SentryLike = {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: unknown, hint?: Record<string, unknown>) => string;
};

let sentry: SentryLike | null = null;

function redactUrl(url: unknown): unknown {
  return typeof url === 'string' ? redactPath(url) : url;
}

// Optional Sentry initialization. Imported dynamically so the app boots even
// when @sentry/node isn't installed (e.g. dev container without the package).
export const initSentry = () => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;

  try {
    const Sentry = require('@sentry/node') as SentryLike;
    Sentry.init({
      dsn,
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
      release: process.env.GIT_COMMIT_SHA ?? undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      sendDefaultPii: false,
      beforeSend(event: any) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.data;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
          // Confirmation-link tokens (`/c/<token>`, Inc 2) never leave the server.
          event.request.url = redactUrl(event.request.url);
        }
        return event;
      },
      beforeBreadcrumb(breadcrumb: any) {
        if (breadcrumb?.data) {
          breadcrumb.data.url = redactUrl(breadcrumb.data.url);
          breadcrumb.data.to = redactUrl(breadcrumb.data.to);
          breadcrumb.data.from = redactUrl(breadcrumb.data.from);
        }
        return breadcrumb;
      },
    });
    sentry = Sentry;
    return Sentry;
  } catch {
    return null;
  }
};

/** Reports a server fault to Sentry, when it is configured, tagged with the request id. */
export function captureException(error: unknown, context: { requestId?: string; path?: string } = {}): void {
  if (!sentry) return;
  try {
    sentry.captureException(error, {
      tags: context.requestId ? { requestId: context.requestId } : undefined,
      extra: context.path ? { path: context.path } : undefined,
    });
  } catch {
    // Reporting must never break the response.
  }
}
