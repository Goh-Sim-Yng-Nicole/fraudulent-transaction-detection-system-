const winston = require('winston');
const config = require('./index');

const REDACTED_FIELDS = new Set([
  'password', 'cardNumber', 'cvv', 'ssn', 'accountNumber',
  'authorization', 'token', 'secret', 'apiKey', 'privateKey',
  'authToken', 'accountSid',
]);
// Handles redact value.
const redactValue = (obj, depth = 0) => {
  if (depth > 6 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactValue(item, depth + 1));

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (REDACTED_FIELDS.has(key)) return [key, '[REDACTED]'];
      return [key, redactValue(value, depth + 1)];
    })
  );
};
const redactFilter = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (REDACTED_FIELDS.has(key)) {
      info[key] = '[REDACTED]';
    } else if (info[key] !== null && typeof info[key] === 'object') {
      info[key] = redactValue(info[key], 1);
    }
  }
  return info;
});

const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  redactFilter(),
  winston.format.json()
);

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  redactFilter(),
  winston.format.printf(({ timestamp, level, message, service, correlationId, ...meta }) => {
    let msg = `${timestamp} [${service}]${correlationId ? ` [${correlationId}]` : ''} ${level}: ${message}`;
    const metaKeys = Object.keys(meta).filter((k) => !['level', 'timestamp', 'service'].includes(k));
    if (metaKeys.length > 0) {
      const metaObj = Object.fromEntries(metaKeys.map((k) => [k, meta[k]]));
      msg += ` ${JSON.stringify(metaObj)}`;
    }
    return msg;
  })
);

const logger = winston.createLogger({
  level: config.logLevel,
  format: jsonFormat,
  defaultMeta: {
    service: config.serviceName,
    version: config.serviceVersion,
    env: config.env,
  },
  transports: [
    new winston.transports.Console({
      format: config.env === 'production' ? jsonFormat : devFormat,
    }),
  ],
  exitOnError: false,
});

logger.child = (meta) => {
  const child = Object.create(logger);
  const baseMeta = { ...meta };

  ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].forEach((level) => {
    child[level] = (message, extra = {}) => {
      logger[level](message, { ...baseMeta, ...extra });
    };
  });

  return child;
};

module.exports = logger;