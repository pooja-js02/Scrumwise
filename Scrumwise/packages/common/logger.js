// One logger for every service (winston).
//
//   log.info('sprint started', { sprint: id })      → what happened, plus named details
//   log.warn(...)  log.error(...)  log.debug(...)
//
// In development the lines are short and coloured:
//   14:05:09.120 info [chat-service] POST /channels/66f…/messages 201 12ms user=66e… id=3f9a1c2b
// In production (NODE_ENV=production or LOG_FORMAT=json) each line is JSON, ready for a log collector.
// LOG_LEVEL chooses how much is shown: error, warn, info (default) or debug (adds every NATS event).
import winston from 'winston';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const readable = printf(({ timestamp: at, level, service, message, stack, ...details }) => {
  const extra = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' ');
  return `${at} ${level} [${service}] ${message}${extra ? ` ${extra}` : ''}${stack ? `\n${stack}` : ''}`;
});

export function createLogger(service) {
  const asJson = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service },
    format: asJson
      ? combine(timestamp(), errors({ stack: true }), json())
      : combine(timestamp({ format: 'HH:mm:ss.SSS' }), errors({ stack: true }), colorize({ level: true }), readable),
    transports: [new winston.transports.Console()],
  });
}
