// Optional Sentry initialization. Imported dynamically so the app boots even
// when @sentry/node isn't installed (e.g. dev container without the package).
export const initSentry = () => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;

  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.GIT_COMMIT_SHA ?? undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      sendDefaultPii: false,
      beforeSend(event: any) {
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
        }
        return event;
      },
    });
    return Sentry;
  } catch {
    return null;
  }
};
