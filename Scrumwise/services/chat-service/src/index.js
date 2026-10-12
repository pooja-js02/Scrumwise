// Chat service: channels (group conversations inside a space) and direct messages.
import { HttpError, mongoose, requireUser, startService, wrap } from '@scrumwise/common';

const { Schema } = mongoose;

const Channel = mongoose.model('Channel', new Schema({
  kind: { type: String, enum: ['channel', 'dm'], default: 'channel' },
  project: { type: String, default: null, index: true }, // the space a channel belongs to; empty for direct messages
  name: { type: String, default: '' },
  about: { type: String, default: '' },
  private: { type: Boolean, default: false },
  members: { type: [String], index: true },
  dmKey: { type: String, unique: true, sparse: true }, // the two user ids, sorted, so a pair has exactly one conversation
  createdBy: { type: String, default: null },
}, { timestamps: true }));

const Message = mongoose.model('Message', new Schema({
  channel: { type: Schema.Types.ObjectId, index: true },
  from: String,
  fromName: String,
  text: { type: String, required: true, maxlength: 4000 },
  at: { type: Date, default: Date.now },
  editedAt: { type: Date, default: null },
  replyTo: { type: Schema.Types.ObjectId, default: null }, // the message this one answers, if any
  reactions: [{ _id: false, emoji: String, user: String }],
}));
const EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

// Messages ready to send out, each with the quote of the message it replies to.
// The quote is looked up now, not stored, so an edited original shows its new text and a deleted one shows nothing.
async function present(messages) {
  const ids = [...new Set(messages.filter((m) => m.replyTo).map((m) => String(m.replyTo)))];
  const originals = new Map((ids.length ? await Message.find({ _id: { $in: ids } }) : []).map((o) => [o.id, o]));
  return messages.map((m) => {
    const original = m.replyTo && originals.get(String(m.replyTo));
    const replyTo = !m.replyTo ? undefined : original ? { id: original.id, fromName: original.fromName, text: original.text } : { id: String(m.replyTo), deleted: true };
    return { ...viewMessage(m), replyTo };
  });
}
const presentOne = async (message) => (await present([message]))[0];

// When each person last read each conversation. Anything newer from someone else is unread.
const Read = mongoose.model('Read', new Schema({ channel: Schema.Types.ObjectId, user: String, at: Date }).index({ channel: 1, user: 1 }, { unique: true }));

// How one person has set up one conversation for themselves. Nobody else is affected by these.
//   muted     no notifications for it
//   hidden    kept out of the sidebar until someone writes in it again
//   clearedAt "delete chat" for a direct message: everything up to this moment is gone for this person only
const Pref = mongoose.model('Pref', new Schema({
  channel: Schema.Types.ObjectId, user: String,
  muted: { type: Boolean, default: false }, hidden: { type: Boolean, default: false }, clearedAt: { type: Date, default: null },
}).index({ channel: 1, user: 1 }, { unique: true }));
const DEFAULT_CHANNELS = ['general', 'issues'];
// A channel can be deleted by whoever created it. The two built-in channels of a space cannot be deleted.
const canDelete = (channel, userId) => channel.kind === 'dm' || (!DEFAULT_CHANNELS.includes(channel.name) && (!channel.createdBy || channel.createdBy === userId));

const viewMessage = (m) => ({
  id: m.id, channel: String(m.channel), from: m.from, fromName: m.fromName, text: m.text, at: m.at.toISOString(),
  editedAt: m.editedAt ? m.editedAt.toISOString() : undefined,
  reactions: (m.reactions || []).map((r) => ({ emoji: r.emoji, user: r.user })),
});

async function summary(channel, userId) {
  const [read, pref] = await Promise.all([Read.findOne({ channel: channel._id, user: userId }), Pref.findOne({ channel: channel._id, user: userId })]);
  const cleared = pref?.clearedAt || new Date(0); // messages up to here were deleted for this person
  const since = read?.at > cleared ? read.at : cleared;
  const [unread, last, reads] = await Promise.all([
    Message.countDocuments({ channel: channel._id, from: { $ne: userId }, at: { $gt: since } }),
    Message.findOne({ channel: channel._id, at: { $gt: cleared } }).sort('-at'),
    Read.find({ channel: channel._id }),
  ]);
  return {
    id: channel.id, kind: channel.kind, project: channel.project, name: channel.name, about: channel.about, private: channel.private, members: channel.members,
    other: channel.kind === 'dm' ? channel.members.find((m) => m !== userId) : null, unread, last: last ? viewMessage(last) : null,
    muted: !!pref?.muted, hidden: !!pref?.hidden, canDelete: canDelete(channel, userId),
    // When each member last read the conversation. A message is "seen" by everyone whose time is later than it.
    reads: reads.map((r) => ({ user: r.user, at: r.at.toISOString() })),
  };
}

async function channelFor(req) {
  const channel = await Channel.findById(req.params.id);
  if (!channel || !channel.members.includes(req.user.id)) throw new HttpError(404, 'This conversation does not exist, or you are not in it.');
  return channel;
}

const slug = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

await startService({
  name: 'chat-service',
  routes(app, bus) {
    app.use(requireUser);
    const markRead = async (channel, userId) => {
      await Read.updateOne({ channel: channel._id, user: userId }, { at: new Date() }, { upsert: true });
      bus.publish('chat.read', { user: userId, channelId: channel.id });
      // Tell the others, so the sender's "seen" mark appears straight away.
      for (const id of channel.members) if (id !== userId) bus.publish(`push.${id}`, { type: 'read', channelId: channel.id });
    };

    app.get('/channels', wrap(async (req, res) => {
      const filter = { kind: 'channel', members: req.user.id };
      if (req.query.project) filter.project = String(req.query.project).toUpperCase();
      const channels = await Channel.find(filter).sort('createdAt');
      res.json(await Promise.all(channels.map((c) => summary(c, req.user.id))));
    }));

    app.post('/channels', wrap(async (req, res) => {
      const name = slug(req.body.name || '');
      const project = String(req.body.project || '').toUpperCase();
      if (!name) throw new HttpError(400, 'Give the channel a name using letters or numbers.');
      if (!project) throw new HttpError(400, 'A channel must belong to a space.');
      if (await Channel.exists({ kind: 'channel', project, name })) throw new HttpError(409, `A channel called #${name} already exists.`);
      const members = [...new Set([req.user.id, ...(Array.isArray(req.body.members) ? req.body.members.map(String) : [])])];
      const channel = await Channel.create({ project, name, about: req.body.about || '', private: !!req.body.private, members, createdBy: req.user.id });
      for (const id of members) bus.publish(`push.${id}`, { type: 'chat', channelId: channel.id });
      res.status(201).json(await summary(channel, req.user.id));
    }));

    app.get('/channels/:id', wrap(async (req, res) => {
      res.json(await summary(await channelFor(req), req.user.id));
    }));

    // Opening a conversation returns its messages and marks it as read.
    app.get('/channels/:id/messages', wrap(async (req, res) => {
      const channel = await channelFor(req);
      const pref = await Pref.findOne({ channel: channel._id, user: req.user.id });
      const messages = await Message.find({ channel: channel._id, at: { $gt: pref?.clearedAt || new Date(0) } }).sort('-at').limit(200);
      await markRead(channel, req.user.id);
      res.json(await present(messages.reverse()));
    }));

    app.post('/channels/:id/messages', wrap(async (req, res) => {
      const channel = await channelFor(req);
      const text = String(req.body.text || '').trim();
      if (!text) throw new HttpError(400, 'Write a message first.');
      const replyTo = req.body.replyTo ? await Message.findOne({ _id: req.body.replyTo, channel: channel._id }) : null;
      if (req.body.replyTo && !replyTo) throw new HttpError(400, 'The message you are replying to no longer exists.');
      const message = await Message.create({ channel: channel._id, from: req.user.id, fromName: req.user.name, text, replyTo: replyTo?._id || null });
      const sent = await presentOne(message);
      await markRead(channel, req.user.id);
      const others = channel.members.filter((m) => m !== req.user.id);
      // A new message brings a hidden conversation back, and people who muted it get no notification.
      await Pref.updateMany({ channel: channel._id, user: { $in: others }, hidden: true }, { hidden: false });
      const muted = (await Pref.find({ channel: channel._id, user: { $in: others }, muted: true })).map((p) => p.user);
      const recipients = others.filter((m) => !muted.includes(m));
      // The message itself goes straight to everyone's browser; the notification service is told separately.
      for (const id of channel.members) bus.publish(`push.${id}`, { type: 'message', channelId: channel.id, message: sent });
      bus.publish('chat.message', { channelId: channel.id, kind: channel.kind, project: channel.project, name: channel.name, from: req.user.id, fromName: req.user.name, text, recipients });
      res.status(201).json(sent);
    }));

    // ----- changing a message that was already sent -----
    const messageFor = async (req, channel, { own = false } = {}) => {
      const message = await Message.findOne({ _id: req.params.mid, channel: channel._id });
      if (!message) throw new HttpError(404, 'This message no longer exists.');
      if (own && message.from !== req.user.id) throw new HttpError(403, 'You can only change your own messages.');
      return message;
    };
    const tellEveryone = (channel, data) => { for (const id of channel.members) bus.publish(`push.${id}`, { channelId: channel.id, ...data }); };

    app.patch('/channels/:id/messages/:mid', wrap(async (req, res) => {
      const channel = await channelFor(req);
      const message = await messageFor(req, channel, { own: true });
      const text = String(req.body.text || '').trim();
      if (!text) throw new HttpError(400, 'A message cannot be empty. Delete it instead.');
      if (text !== message.text) { message.text = text; message.editedAt = new Date(); await message.save(); }
      const changed = await presentOne(message);
      tellEveryone(channel, { type: 'message_edited', message: changed });
      res.json(changed);
    }));

    // Deleting removes the message for everyone: it is gone from the conversation and from notifications.
    app.delete('/channels/:id/messages/:mid', wrap(async (req, res) => {
      const channel = await channelFor(req);
      const message = await messageFor(req, channel, { own: true });
      await message.deleteOne();
      tellEveryone(channel, { type: 'message_deleted', messageId: message.id });
      bus.publish('chat.deleted', { channelId: channel.id, kind: channel.kind, project: channel.project, name: channel.name, from: req.user.id, fromName: req.user.name, text: message.text, recipients: channel.members.filter((m) => m !== req.user.id) });
      res.status(204).end();
    }));

    // Adds your reaction, or takes it away if you had already added the same one.
    app.post('/channels/:id/messages/:mid/reactions', wrap(async (req, res) => {
      const channel = await channelFor(req);
      const message = await messageFor(req, channel);
      const emoji = String(req.body.emoji || '');
      if (!EMOJI.includes(emoji)) throw new HttpError(400, 'Choose one of the available reactions.');
      const had = message.reactions.some((r) => r.emoji === emoji && r.user === req.user.id);
      message.reactions = had ? message.reactions.filter((r) => !(r.emoji === emoji && r.user === req.user.id)) : [...message.reactions, { emoji, user: req.user.id }];
      await message.save();
      const changed = await presentOne(message);
      tellEveryone(channel, { type: 'message_edited', message: changed });
      res.json(changed);
    }));

    // ----- your own settings for a conversation: mute, hide, delete -----
    const setPref = async (req, change) => {
      const channel = await channelFor(req);
      await Pref.updateOne({ channel: channel._id, user: req.user.id }, change, { upsert: true });
      bus.publish(`push.${req.user.id}`, { type: 'chat', channelId: channel.id }); // your other tabs update too
      return channel;
    };
    app.post('/channels/:id/mute', wrap(async (req, res) => {
      const channel = await setPref(req, { muted: req.body.muted !== false });
      if (req.body.muted !== false) bus.publish('chat.read', { user: req.user.id, channelId: channel.id }); // clear what was already notified
      res.json(await summary(channel, req.user.id));
    }));
    app.post('/channels/:id/hide', wrap(async (req, res) => {
      res.json(await summary(await setPref(req, { hidden: req.body.hidden !== false }), req.user.id));
    }));
    // Delete. A direct message is deleted for you only: its history is cleared on your side and it leaves
    // your list; the other person keeps theirs. A channel is deleted for everyone, by whoever created it.
    app.delete('/channels/:id', wrap(async (req, res) => {
      const channel = await channelFor(req);
      if (channel.kind === 'dm') {
        await Pref.updateOne({ channel: channel._id, user: req.user.id }, { clearedAt: new Date(), hidden: false }, { upsert: true });
        await markRead(channel, req.user.id);
        bus.publish(`push.${req.user.id}`, { type: 'chat', channelId: channel.id });
        return res.status(204).end();
      }
      if (DEFAULT_CHANNELS.includes(channel.name)) throw new HttpError(400, `#${channel.name} is part of every space and cannot be deleted. You can hide or mute it.`);
      if (!canDelete(channel, req.user.id)) throw new HttpError(403, 'Only the person who created a channel can delete it.');
      await Promise.all([Message.deleteMany({ channel: channel._id }), Read.deleteMany({ channel: channel._id }), Pref.deleteMany({ channel: channel._id }), channel.deleteOne()]);
      for (const id of channel.members) {
        bus.publish('chat.read', { user: id, channelId: channel.id }); // its notifications no longer lead anywhere
        bus.publish(`push.${id}`, { type: 'channel_deleted', channelId: channel.id });
      }
      res.status(204).end();
    }));

    app.post('/channels/:id/read', wrap(async (req, res) => {
      await markRead(await channelFor(req), req.user.id);
      res.status(204).end();
    }));

    // ----- direct messages -----
    app.get('/dms', wrap(async (req, res) => {
      const channels = await Channel.find({ kind: 'dm', members: req.user.id });
      const list = await Promise.all(channels.map((c) => summary(c, req.user.id)));
      res.json(list.filter((c) => c.last)); // only people you have actually exchanged messages with
    }));

    // Finds the conversation with a person, creating it the first time.
    app.post('/dms', wrap(async (req, res) => {
      const other = String(req.body.userId || '');
      if (!other || other === req.user.id) throw new HttpError(400, 'Choose another person to message.');
      const dmKey = [req.user.id, other].sort().join(':');
      const channel = await Channel.findOneAndUpdate({ dmKey }, { $setOnInsert: { kind: 'dm', dmKey, members: [req.user.id, other] } }, { upsert: true, new: true });
      res.json(await summary(channel, req.user.id));
    }));
  },

  subscriptions(bus) {
    // Every space has two channels with everyone in it: #general, and #issues for discussing issues with clients.
    // Events can arrive in any order (a "member added" may be handled before "space created"), so both
    // handlers do the same thing: make sure the channels exist and that every current member is in them.
    const DEFAULTS = [['general', 'Everyone in this space. Questions, updates and decisions.'], ['issues', 'Discuss any issue here with the team and the clients.']];
    const syncSpace = async ({ project, members }) => {
      for (const [name, about] of DEFAULTS) {
        await Channel.updateOne({ kind: 'channel', project, name }, { $setOnInsert: { about }, $addToSet: { members: { $each: members } } }, { upsert: true });
      }
      // New members also join every other public channel of the space.
      await Channel.updateMany({ kind: 'channel', project, private: false }, { $addToSet: { members: { $each: members } } });
      for (const id of members) bus.publish(`push.${id}`, { type: 'chat' });
    };
    bus.subscribe('project.created', syncSpace);
    bus.subscribe('project.member_added', syncSpace);
    bus.subscribe('project.member_removed', async ({ project, userId }) => {
      await Channel.updateMany({ kind: 'channel', project }, { $pull: { members: userId } });
      bus.publish(`push.${userId}`, { type: 'chat' });
    });
  },
});
