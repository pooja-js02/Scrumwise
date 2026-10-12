// Shared plumbing for every backend service: database, message bus, HTTP server and errors.
import express from 'express';
import mongoose from 'mongoose';
import { connect } from 'nats';
import protobuf from 'protobufjs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.js';

export { createLogger, mongoose };

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Lets route handlers be async functions; a thrown error reaches the error handler.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// The gateway has already checked the login token and tells us who the caller is in these headers.
export function requireUser(req, _res, next) {
  const id = req.header('x-user-id');
  if (!id) return next(new HttpError(401, 'You are not logged in.'));
  req.user = { id, name: decodeURIComponent(req.header('x-user-name') || '') };
  next();
}

// Events are sent as Protocol Buffers, a compact binary format with a fixed schema (proto/events.proto).
// Each subject has one message type, so a service cannot publish a shape the others do not expect.
const proto = protobuf.loadSync(fileURLToPath(new URL('./proto/events.proto', import.meta.url)));
const type = (name) => proto.lookupType(`scrumwise.${name}`);
const TYPES = [
  ['user.created', type('UserCreated')],
  ['project.', type('SpaceEvent')],
  ['sprint.', type('SpaceEvent')],
  ['issue.', type('IssueEvent')],
  ['chat.message', type('ChatMessageSent')],
  ['chat.deleted', type('ChatMessageSent')],
  ['chat.read', type('ChatRead')],
  ['push.', type('Push')],
];
function typeFor(subject) {
  const found = TYPES.find(([prefix]) => subject === prefix || (prefix.endsWith('.') && subject.startsWith(prefix)));
  if (!found) throw new Error(`No protobuf message type is registered for the subject "${subject}".`);
  return found[1];
}
export const encode = (subject, data) => { const T = typeFor(subject); return T.encode(T.fromObject(data)).finish(); };
// Fields that were not set come back as undefined; lists always come back as arrays.
export const decode = (subject, bytes) => { const T = typeFor(subject); return T.toObject(T.decode(bytes), { arrays: true }); };

// The message bus (NATS). Services never call each other directly; they publish and subscribe to events.
export async function connectBus(name, log = createLogger(name)) {
  const nc = await connect({ servers: process.env.NATS_URL, name, maxReconnectAttempts: -1, waitOnFirstConnect: true });
  const listen = (subject, handler, options) => {
    const sub = nc.subscribe(subject, options);
    (async () => {
      for await (const msg of sub) {
        try {
          if (!msg.subject.startsWith('push.')) log.debug(`event received ${msg.subject}`);
          await handler(decode(msg.subject, msg.data), msg.subject);
        } catch (err) {
          log.error(`failed handling event ${msg.subject}`, { stack: err.stack });
        }
      }
    })();
  };
  return {
    publish: (subject, data) => {
      if (!subject.startsWith('push.')) log.debug(`event published ${subject}`);
      nc.publish(subject, encode(subject, data));
    },
    // One copy of this service handles each event, even when several copies are running.
    subscribe: (subject, handler) => listen(subject, handler, { queue: name }),
    // Every copy receives the event (used by the gateway to reach whichever copy holds the browser connection).
    subscribeAll: (subject, handler) => listen(subject, handler),
    close: () => nc.drain(),
  };
}

export async function startService({ name, port = process.env.PORT, database = true, json = true, routes, subscriptions }) {
  const log = createLogger(name);
  // Problems outside any request (a rejected promise nobody handled, a crash) are logged before the process stops.
  process.on('unhandledRejection', (reason) => log.error('unhandled promise rejection', { stack: reason?.stack || String(reason) }));
  process.on('uncaughtException', (err) => { log.error('uncaught exception', { stack: err.stack }); process.exit(1); });

  if (database) {
    await mongoose.connect(process.env.MONGO_URI);
    log.info('database connected', { database: mongoose.connection.name });
  }
  const bus = await connectBus(name, log);
  log.info('message bus connected');
  const app = express();
  app.disable('x-powered-by');

  // One line per request: method, path, status and how long it took, with who asked and a request id.
  // The gateway creates the id and passes it on, so one click can be followed through every service.
  // Request bodies, passwords and tokens are never logged.
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || randomUUID().slice(0, 8);
    res.setHeader('x-request-id', req.id);
    if (req.path === '/health') return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log[level](`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms}ms`, {
        what: res.locals.label, user: res.locals.user || req.headers['x-user-id'], id: req.id,
      });
    });
    next();
  });

  if (json) app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => res.json({ service: name, ok: true }));
  routes?.(app, bus, log);
  subscriptions?.(bus, log);

  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const bad = err.name === 'ValidationError' || err.name === 'CastError';
    const status = err.status || (bad ? 400 : 500);
    // An expected refusal (wrong password, not a member) is a warning with its message; anything else is a bug.
    if (status === 500) log.error(`${req.method} ${req.originalUrl.split('?')[0]} failed`, { id: req.id, stack: err.stack });
    else res.locals.label = err.message;
    res.status(status).json({ error: status === 500 ? 'Something went wrong.' : err.message });
  });

  const server = app.listen(port, () => log.info(`listening on ${port}`));
  const stop = async () => {
    log.info('shutting down');
    server.close();
    await bus.close();
    if (database) await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return { app, bus, server, log };
}
