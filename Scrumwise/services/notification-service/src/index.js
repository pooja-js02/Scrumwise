// Notification service: listens to what happens in the other services and tells the people concerned.
import { mongoose, requireUser, startService, wrap } from '@scrumwise/common';

const Notification = mongoose.model('Notification', new mongoose.Schema({
  user: { type: String, index: true },
  kind: { type: String, enum: ['message', 'channel', 'board', 'issue'] },
  text: String,
  detail: String,
  // Where clicking the notification should take the person.
  link: { project: String, channelId: String, issueKey: String },
  // Unread chat notifications for one conversation are merged into a single entry.
  group: { type: String, default: null },
  read: { type: Boolean, default: false },
  at: { type: Date, default: Date.now },
}));

// What a person wants to be notified about. Everything is on until they switch it off.
// `KINDS` are the in-product switches. The rest (email, per-space choices, digests) is kept in `more`.
const KINDS = ['message', 'channel', 'board', 'assigned', 'comment'];
const Setting = mongoose.model('Setting', new mongoose.Schema({
  user: { type: String, unique: true },
  ...Object.fromEntries(KINDS.map((k) => [k, { type: Boolean, default: true }])),
  more: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { minimize: false }));

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const EVERY = [3, 10, 30, 60]; // minutes between grouped emails
// Fills in every setting, so the pages never have to guess a default.
function viewSetting(s) {
  const m = s?.more || {};
  return {
    ...Object.fromEntries(KINDS.map((k) => [k, s?.[k] !== false])),
    email: {
      on: bool(m.email?.on, true), assignee: bool(m.email?.assignee, true), reporter: bool(m.email?.reporter, true), own: bool(m.email?.own, false),
      group: bool(m.email?.group, true), every: EVERY.includes(m.email?.every) ? m.email.every : 3, format: m.email?.format === 'text' ? 'text' : 'html',
    },
    emailKinds: { assigned: bool(m.emailKinds?.assigned, true), board: bool(m.emailKinds?.board, true), comment: bool(m.emailKinds?.comment, true) },
    spaces: (Array.isArray(m.spaces) ? m.spaces : []).filter((x) => /^[A-Z]{2,5}$/.test(x?.key || '')).slice(0, 50).map((x) => ({ key: x.key, inApp: bool(x.inApp, true), email: bool(x.email, true) })),
    digests: { due: { on: bool(m.digests?.due?.on, true), email: bool(m.digests?.due?.email, true), inApp: bool(m.digests?.due?.inApp, true) }, weekly: { on: bool(m.digests?.weekly?.on, true), email: bool(m.digests?.weekly?.email, true) } },
  };
}

const view = (n) => ({ id: n.id, kind: n.kind, text: n.text, detail: n.detail, link: n.link, read: n.read, at: n.at });

await startService({
  name: 'notification-service',
  routes(app, bus) {
    app.use(requireUser);

    app.get('/notifications', wrap(async (req, res) => {
      const [list, unread] = await Promise.all([
        Notification.find({ user: req.user.id }).sort('-at').limit(50),
        Notification.countDocuments({ user: req.user.id, read: false }),
      ]);
      res.json({ unread, list: list.map(view) });
    }));

    app.get('/notifications/settings', wrap(async (req, res) => {
      res.json(viewSetting(await Setting.findOne({ user: req.user.id })));
    }));

    // Send only the parts you want to change; `email`, `emailKinds` and `digests` are merged, `spaces` is replaced.
    app.put('/notifications/settings', wrap(async (req, res) => {
      const b = req.body || {};
      const setting = await Setting.findOne({ user: req.user.id }) || new Setting({ user: req.user.id });
      for (const k of KINDS) if (typeof b[k] === 'boolean') setting[k] = b[k];
      const now = viewSetting(setting);
      const obj = (x) => (x && typeof x === 'object' ? x : {});
      setting.more = viewSetting({ more: {
        email: { ...now.email, ...obj(b.email) }, emailKinds: { ...now.emailKinds, ...obj(b.emailKinds) },
        spaces: Array.isArray(b.spaces) ? b.spaces : now.spaces,
        digests: { due: { ...now.digests.due, ...obj(b.digests?.due) }, weekly: { ...now.digests.weekly, ...obj(b.digests?.weekly) } },
      } });
      setting.more = (({ email, emailKinds, spaces, digests }) => ({ email, emailKinds, spaces, digests }))(setting.more);
      setting.markModified('more');
      await setting.save();
      res.json(viewSetting(setting));
    }));

    // Marks one notification as read, or all of them when no id is given.
    app.post('/notifications/read', wrap(async (req, res) => {
      const filter = { user: req.user.id, read: false };
      if (req.body.id) filter._id = req.body.id;
      await Notification.updateMany(filter, { read: true });
      bus.publish(`push.${req.user.id}`, { type: 'notification' });
      res.status(204).end();
    }));
  },

  subscriptions(bus) {
    // `setting` names the switch in the person's notification settings that covers this kind of news.
    // A person can also silence one whole space; direct messages belong to no space, so they are never affected.
    const tell = async (users, setting, data) => {
      const wanted = [...new Set(users.filter(Boolean))];
      const project = data.link?.project;
      const off = new Set((await Setting.find({ user: { $in: wanted } }))
        .filter((s) => s[setting] === false || (project && viewSetting(s).spaces.some((x) => x.key === project && !x.inApp)))
        .map((s) => s.user));
      for (const user of wanted.filter((id) => !off.has(id))) {
        if (data.group) await Notification.findOneAndUpdate({ user, group: data.group, read: false }, { ...data, user, at: new Date() }, { upsert: true });
        else await Notification.create({ ...data, user });
        bus.publish(`push.${user}`, { type: 'notification' });
      }
    };
    const others = (e) => e.members.filter((m) => m !== e.by);

    bus.subscribe('chat.message', (e) => tell(e.recipients, e.kind === 'dm' ? 'message' : 'channel', {
      kind: e.kind === 'dm' ? 'message' : 'channel',
      text: e.kind === 'dm' ? `You got a message from ${e.fromName}` : `In #${e.name} there is some discussion`,
      detail: e.kind === 'dm' ? e.text : `${e.fromName}: ${e.text}`,
      link: { project: e.project, channelId: e.channelId },
      group: `chat:${e.channelId}`,
    }));

    // The sender deleted a message: remove any notification that quotes it, read or not.
    bus.subscribe('chat.deleted', async (e) => {
      const detail = e.kind === 'dm' ? e.text : `${e.fromName}: ${e.text}`;
      for (const user of e.recipients) {
        const { deletedCount } = await Notification.deleteMany({ user, group: `chat:${e.channelId}`, detail });
        if (deletedCount) bus.publish(`push.${user}`, { type: 'notification' });
      }
    });

    // Reading a conversation clears its notification.
    bus.subscribe('chat.read', async ({ user, channelId }) => {
      const { modifiedCount } = await Notification.updateMany({ user, group: `chat:${channelId}`, read: false }, { read: true });
      if (modifiedCount) bus.publish(`push.${user}`, { type: 'notification' });
    });

    bus.subscribe('issue.status_changed', (e) => tell(others(e), 'board', {
      kind: 'board', text: 'There is a new update on the board',
      detail: `${e.byName} moved ${e.key} “${e.title}” to ${e.statusName}.`, link: { project: e.project, issueKey: e.key },
    }));

    bus.subscribe('issue.assigned', (e) => tell([e.assignee], 'assigned', {
      kind: 'issue', text: 'An issue was assigned to you', detail: `${e.key} “${e.title}”, by ${e.byName}.`, link: { project: e.project, issueKey: e.key },
    }));

    bus.subscribe('issue.commented', (e) => tell([e.assignee, e.reporter].filter((id) => id !== e.by), 'comment', {
      kind: 'issue', text: `${e.byName} commented on ${e.key}`, detail: e.text, link: { project: e.project, issueKey: e.key },
    }));

    // Anything that changes a space's issues or sprints refreshes the pages of everyone looking at it.
    for (const subject of ['issue.created', 'issue.updated', 'sprint.changed']) {
      bus.subscribe(subject, (e) => { for (const user of others(e)) bus.publish(`push.${user}`, { type: 'board', project: e.project }); });
    }
    for (const subject of ['project.member_added', 'project.member_removed']) {
      bus.subscribe(subject, (e) => { for (const user of [...e.members, e.userId]) bus.publish(`push.${user}`, { type: 'spaces', project: e.project }); });
    }
  },
});
