const winston = require('winston');
const config = require('./index');

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${config.serviceName}] ${level}: ${message}${extra}`;
  })
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

module.exports = winston.createLogger({
  level: config.logLevel,
  defaultMeta: { service: config.serviceName },
  transports: [
    new winston.transports.Console({
      format: config.env === 'production' ? prodFormat : devFormat
    })
  ]
});
