import pino from 'pino';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.code',
  'req.body.otp',
  '*.cnic',
  '*.password',
  '*.codeHash',
  '*.tokenHash',
];

export const buildLogger = () => {
  const isProd = process.env.NODE_ENV === 'production';
  const betterStackToken = process.env.BETTER_STACK_TOKEN;
  const betterStackHost = process.env.BETTER_STACK_HOST ?? 'in.logs.betterstack.com';

  const targets: pino.TransportTargetOptions[] = [];

  if (!isProd) {
    targets.push({
      target: 'pino-pretty',
      level: 'debug',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    });
  } else {
    targets.push({
      target: 'pino/file',
      level: 'info',
      options: { destination: 1 },
    });
  }

  if (betterStackToken) {
    targets.push({
      target: '@logtail/pino',
      level: 'info',
      options: { sourceToken: betterStackToken, options: { endpoint: `https://${betterStackHost}` } },
    });
  }

  return pino({
    level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    base: {
      service: 'api',
      env: process.env.NODE_ENV ?? 'development',
      version: process.env.GIT_COMMIT_SHA ?? 'dev',
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: targets.length > 0 ? { targets } : undefined,
  });
};
