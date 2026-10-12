// API gateway: the only backend the browser talks to.
//   POST /api/graphql   every question and change, as GraphQL
//   WS   /api/live      a live stream of updates, over a WebSocket the browser connects to directly
//   *    /api/v1/...    the same operations as a REST API, for other tools and for testing
//   GET  /api/docs      Swagger: the REST API described, with a button to try each request
// It checks the login token, then asks the service that owns the data.
import jwt from 'jsonwebtoken';
import { GraphQLError } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';
import swaggerUi from 'swagger-ui-express';
import { WebSocketServer } from 'ws';
import { startService } from '@scrumwise/common';
import { openapi } from './openapi.js';
import { schema } from './schema.js';

const { AUTH_URL, PROJECTS_URL, CHAT_URL, NOTIFICATIONS_URL, JWT_SECRET } = process.env;

function identify(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// A token stays valid for days, but the account behind it can disappear (deleted, or the database reset).
// So each token is checked against the auth service, and the answer is remembered for a minute.
const known = new Map(); // user id → time until which we trust it
async function accountExists(who) {
  if (!who) return false;
  if (known.get(who.sub) > Date.now()) return true;
  try {
    const res = await fetch(`${AUTH_URL}/users/me`, { headers: { 'x-user-id': who.sub } });
    if (res.ok) { known.set(who.sub, Date.now() + 60_000); return true; }
    known.delete(who.sub);
    return res.status >= 500; // if the auth service itself is failing, do not log everyone out
  } catch {
    return true;
  }
}
const currentUser = async (token) => { const who = identify(token); return (await accountExists(who)) ? who : null; };

// Calls a service on behalf of the logged-in person. The service trusts these headers because
// only the gateway can reach it.
async function ask(ctx, url, { method = 'GET', body, open = false } = {}) {
  // The request id travels with the call, so the service's log line can be matched to the gateway's.
  if (!ctx.user && !open) throw new GraphQLError('You are not logged in.', { extensions: { code: 'UNAUTHENTICATED' } });
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': ctx.requestId,
        ...(ctx.user ? { 'x-user-id': ctx.user.sub, 'x-user-name': encodeURIComponent(ctx.user.name) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GraphQLError('This part of Scrumwise is not available right now. Try again in a moment.');
  }
  if (res.status === 204) return true;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new GraphQLError(data?.error || 'Something went wrong.');
  return data;
}

const space = (p) => ({ ...p, issueCount: p.issues ?? null });
const id = encodeURIComponent;

// One function per field of Query and Mutation in schema.js.
const resolvers = {
  // ----- people -----
  me: (_a, ctx) => ask(ctx, `${AUTH_URL}/users/me`),
  users: (_a, ctx) => ask(ctx, `${AUTH_URL}/users`),
  signup: (a, ctx) => ask(ctx, `${AUTH_URL}/signup`, { method: 'POST', body: a, open: true }),
  login: (a, ctx) => ask(ctx, `${AUTH_URL}/login`, { method: 'POST', body: a, open: true }),
  updateProfile: (a, ctx) => ask(ctx, `${AUTH_URL}/users/me`, { method: 'PATCH', body: a }),

  // ----- spaces -----
  spaces: async (_a, ctx) => (await ask(ctx, `${PROJECTS_URL}/projects`)).map(space),
  space: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects/${id(a.key)}`),
  createSpace: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects`, { method: 'POST', body: a }),
  addMember: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects/${id(a.space)}/members`, { method: 'POST', body: { userId: a.user, role: a.role || 'Member' } }),
  setMemberRole: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects/${id(a.space)}/members/${id(a.user)}`, { method: 'PATCH', body: { role: a.role } }),
  setColumns: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects/${id(a.space)}/columns`, { method: 'PUT', body: { columns: a.columns } }),
  removeMember: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects/${id(a.space)}/members/${id(a.user)}`, { method: 'DELETE' }),

  // ----- issues -----
  myIssues: (_a, ctx) => ask(ctx, `${PROJECTS_URL}/issues/mine`),
  createIssue: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects/${id(a.space)}/issues`, { method: 'POST', body: a.input }),
  // Only the fields present in the input are changed, so "assignee: null" clears it and leaving it out keeps it.
  updateIssue: (a, ctx) => ask(ctx, `${PROJECTS_URL}/issues/${id(a.key)}`, { method: 'PATCH', body: a.input }),
  deleteIssue: (a, ctx) => ask(ctx, `${PROJECTS_URL}/issues/${id(a.key)}`, { method: 'DELETE' }),
  addComment: (a, ctx) => ask(ctx, `${PROJECTS_URL}/issues/${id(a.issue)}/comments`, { method: 'POST', body: { text: a.text, parent: a.parent } }),
  deleteComment: (a, ctx) => ask(ctx, `${PROJECTS_URL}/issues/${id(a.issue)}/comments/${id(a.id)}`, { method: 'DELETE' }),

  // ----- sprints -----
  createSprint: (a, ctx) => ask(ctx, `${PROJECTS_URL}/projects/${id(a.space)}/sprints`, { method: 'POST', body: a.input }),
  updateSprint: (a, ctx) => ask(ctx, `${PROJECTS_URL}/sprints/${id(a.id)}`, { method: 'PATCH', body: a.input }),
  startSprint: (a, ctx) => ask(ctx, `${PROJECTS_URL}/sprints/${id(a.id)}/start`, { method: 'POST' }),
  completeSprint: (a, ctx) => ask(ctx, `${PROJECTS_URL}/sprints/${id(a.id)}/complete`, { method: 'POST', body: { moveTo: a.moveTo || null } }),
  deleteSprint: (a, ctx) => ask(ctx, `${PROJECTS_URL}/sprints/${id(a.id)}`, { method: 'DELETE' }),

  // ----- chat -----
  channels: (a, ctx) => ask(ctx, `${CHAT_URL}/channels?project=${id(a.project)}`),
  channel: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.id)}`),
  messages: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/messages`),
  directMessages: (_a, ctx) => ask(ctx, `${CHAT_URL}/dms`),
  createChannel: (a, ctx) => ask(ctx, `${CHAT_URL}/channels`, { method: 'POST', body: a.input }),
  sendMessage: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/messages`, { method: 'POST', body: { text: a.text, replyTo: a.replyTo || null } }),
  editMessage: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/messages/${id(a.id)}`, { method: 'PATCH', body: { text: a.text } }),
  deleteMessage: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/messages/${id(a.id)}`, { method: 'DELETE' }),
  reactToMessage: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/messages/${id(a.id)}/reactions`, { method: 'POST', body: { emoji: a.emoji } }),
  markRead: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/read`, { method: 'POST' }),
  muteConversation: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/mute`, { method: 'POST', body: { muted: a.muted } }),
  hideConversation: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}/hide`, { method: 'POST', body: { hidden: a.hidden } }),
  deleteConversation: (a, ctx) => ask(ctx, `${CHAT_URL}/channels/${id(a.channel)}`, { method: 'DELETE' }),
  openDirectMessage: (a, ctx) => ask(ctx, `${CHAT_URL}/dms`, { method: 'POST', body: { userId: a.user } }),

  // ----- notifications -----
  notifications: (_a, ctx) => ask(ctx, `${NOTIFICATIONS_URL}/notifications`),
  notificationSettings: (_a, ctx) => ask(ctx, `${NOTIFICATIONS_URL}/notifications/settings`),
  setNotificationSettings: (a, ctx) => ask(ctx, `${NOTIFICATIONS_URL}/notifications/settings`, { method: 'PUT', body: a.input }),
  readNotifications: (a, ctx) => ask(ctx, `${NOTIFICATIONS_URL}/notifications/read`, { method: 'POST', body: { id: a.id } }),
};

// Open browser connections (WebSockets), by user id.
const streams = new Map();
const send = (socket, data) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data)); };

const { server, log } = await startService({
  name: 'api-gateway',
  database: false,
  routes(app) {
    // For the log: who is asking (from the token; nothing is trusted from it here) and, for GraphQL, which operation.
    app.use((req, res, next) => {
      const header = req.headers.authorization || '';
      res.locals.user = header.startsWith('Bearer ') ? identify(header.slice(7))?.sub : undefined;
      next();
    });
    app.all('/api/graphql', (req, res, next) => {
      const found = String(req.body?.query || '').match(/^\s*(query|mutation)?[^{]*\{\s*(\w+)/);
      if (found) res.locals.label = `${found[1] || 'query'} ${found[2]}`;
      next();
    }, createHandler({
      schema,
      rootValue: resolvers,
      context: async (req) => {
        const header = req.headers.authorization || '';
        return { user: header.startsWith('Bearer ') ? await currentUser(header.slice(7)) : null, requestId: req.raw.id };
      },
    }));

    // ----- REST API and its Swagger page -----
    app.get('/api/openapi.json', (_req, res) => res.json(openapi));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
      customSiteTitle: 'Scrumwise API',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
    }));
    // Each path prefix belongs to one service. The gateway checks the token, then passes the request on.
    const REST = [
      ['/auth', AUTH_URL, '', true], // sign up and log in need no token
      ['/users', AUTH_URL, '/users'],
      ['/projects', PROJECTS_URL, '/projects'], ['/issues', PROJECTS_URL, '/issues'], ['/sprints', PROJECTS_URL, '/sprints'],
      ['/channels', CHAT_URL, '/channels'], ['/dms', CHAT_URL, '/dms'],
      ['/notifications', NOTIFICATIONS_URL, '/notifications'],
    ];
    app.use('/api/v1', async (req, res) => {
      const route = REST.find(([prefix]) => req.path === prefix || req.path.startsWith(`${prefix}/`));
      if (!route) return res.status(404).json({ error: 'Not found. See /api/docs for the list of endpoints.' });
      const [prefix, service, base, open] = route;
      const header = req.headers.authorization || '';
      const who = header.startsWith('Bearer ') ? await currentUser(header.slice(7)) : null;
      if (!open && !who) return res.status(401).json({ error: 'You are not logged in. Send the token from /auth/login as "Authorization: Bearer <token>".' });
      try {
        const answer = await fetch(service + base + req.url.slice(prefix.length), {
          method: req.method,
          headers: { 'Content-Type': 'application/json', 'x-request-id': req.id, ...(who ? { 'x-user-id': who.sub, 'x-user-name': encodeURIComponent(who.name) } : {}) },
          body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        });
        res.status(answer.status);
        if (answer.status === 204) return res.end();
        res.type('application/json').send(await answer.text());
      } catch {
        res.status(502).json({ error: 'This part of Scrumwise is not available right now. Try again in a moment.' });
      }
    });

    // How many browser tabs are connected for live updates right now. Useful when "nothing arrives live".
    app.get('/api/live-status', (_req, res) => {
      const tabs = [...streams.values()].map((set) => set.size);
      res.json({ people: tabs.filter((n) => n > 0).length, tabs: tabs.reduce((a, b) => a + b, 0), perPerson: tabs.filter((n) => n > 0) });
    });
  },
  subscriptions(bus) {
    // Any service can reach a person's browser by publishing to "push.<user id>".
    bus.subscribeAll('push.*', (data, subject) => {
      const to = subject.slice(5);
      // "push.all" goes to everyone who is connected; anything else to one person.
      const open = to === 'all' ? [...streams.values()].flatMap((set) => [...set]) : [...(streams.get(to) || [])];
      for (const socket of open) send(socket, data);
    });
  },
});

// Live updates. Each browser tab opens one WebSocket straight to the gateway (not through the dev
// server's proxy), so a dropped connection is noticed at once and the tab reconnects within a second.
// A WebSocket cannot send headers from a browser, so the token comes in the address.
const live = new WebSocketServer({ server, path: '/api/live' });
live.on('connection', async (socket, req) => {
  const who = await currentUser(new URL(req.url, 'http://gateway').searchParams.get('token'));
  if (!who) { log.warn('live connection refused: not logged in'); return socket.close(4401, 'not logged in'); }
  if (!streams.has(who.sub)) streams.set(who.sub, new Set());
  streams.get(who.sub).add(socket);
  log.info('live connection opened', { user: who.sub, tabs: streams.get(who.sub).size });
  socket.on('close', () => { streams.get(who.sub)?.delete(socket); log.info('live connection closed', { user: who.sub, tabs: streams.get(who.sub)?.size || 0 }); });
  socket.on('error', () => socket.close());
  send(socket, { type: 'ping' });
});
// A regular heartbeat. A tab that stops hearing it knows its connection is dead and reconnects.
setInterval(() => { for (const set of streams.values()) for (const socket of set) send(socket, { type: 'ping' }); }, 10_000);
