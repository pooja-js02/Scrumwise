// Redux store for the chat micro-frontend. Sagas load conversations, send messages
// and react to messages pushed by the server.
import { createAction, createSlice } from '@reduxjs/toolkit';
import { eventChannel } from 'redux-saga';
import { all, call, fork, put, select, take, takeEvery, takeLatest } from 'redux-saga/effects';
import { emit, gql, makeStore, session, toast, windowChannel } from '@scrumwise/ui';

const MESSAGE = 'id channel from fromName text at editedAt reactions { emoji user } replyTo { id fromName text deleted }';
const CHANNEL = 'id kind project name about private members other reads { user at } muted hidden canDelete';
const OPEN = `query ($id: ID!) { channel(id: $id) { ${CHANNEL} } messages(channel: $id) { ${MESSAGE} } }`;
const SEND = `mutation ($channel: ID!, $text: String!, $replyTo: ID) { sendMessage(channel: $channel, text: $text, replyTo: $replyTo) { ${MESSAGE} } }`;
const READ = 'mutation ($channel: ID!) { markRead(channel: $channel) }';
const READS = 'query ($id: ID!) { channel(id: $id) { reads { user at } } }';
const EDIT = `mutation ($channel: ID!, $id: ID!, $text: String!) { message: editMessage(channel: $channel, id: $id, text: $text) { ${MESSAGE} } }`;
const REACT = `mutation ($channel: ID!, $id: ID!, $emoji: String!) { message: reactToMessage(channel: $channel, id: $id, emoji: $emoji) { ${MESSAGE} } }`;
const DELETE = 'mutation ($channel: ID!, $id: ID!) { deleteMessage(channel: $channel, id: $id) }';
export const EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];
export const QUICK_EMOJI = ['👍', '❤️', '😂', '😮']; // shown directly in the toolbar over a message
const MEMBERS = 'query ($key: ID!) { space(key: $key) { project { members { user role } } } }';
export const MUTE = 'mutation ($channel: ID!, $muted: Boolean!) { muteConversation(channel: $channel, muted: $muted) { id } }';
export const HIDE = 'mutation ($channel: ID!, $hidden: Boolean!) { hideConversation(channel: $channel, hidden: $hidden) { id } }';
export const DELETE_CONVERSATION = 'mutation ($channel: ID!) { deleteConversation(channel: $channel) }';
export const CREATE_CHANNEL = 'mutation ($input: ChannelInput!) { createChannel(input: $input) { id } }';
export const OPEN_DM = 'mutation ($user: ID!) { openDirectMessage(user: $user) { id } }';

const slice = createSlice({
  name: 'chat',
  initialState: {
    id: null,       // the open conversation
    channel: null,  // its details; null while loading
    messages: [],
    error: '',
    members: null,  // the space's members, for the "create a channel" window
    replyingTo: null, // the message being answered in the box at the bottom, if any
  },
  reducers: {
    opened(state, action) { state.id = action.payload; state.channel = null; state.messages = []; state.error = ''; state.replyingTo = null; },
    replyStarted(state, action) { state.replyingTo = action.payload; },
    replyCancelled(state) { state.replyingTo = null; },
    // The conversation left the screen. Without this, messages arriving later would be marked as read unseen.
    closed(state, action) { if (state.id === action.payload) { state.id = null; state.channel = null; state.messages = []; } },
    loaded(state, action) { state.channel = action.payload.channel; state.messages = action.payload.messages; },
    failed(state, action) { state.error = action.payload; },
    received(state, action) { if (!state.messages.some((m) => m.id === action.payload.id)) state.messages.push(action.payload); },
    // An edit or a reaction: the message is swapped for its new version.
    // Quotes of the changed message are updated too.
    replaced(state, action) {
      const next = action.payload;
      state.messages = state.messages.map((m) => (m.id === next.id ? next : m.replyTo?.id === next.id ? { ...m, replyTo: { ...m.replyTo, text: next.text } } : m));
    },
    // A deleted message disappears, and so does its text in any reply that quoted it.
    removed(state, action) {
      const id = action.payload;
      state.messages = state.messages.filter((m) => m.id !== id).map((m) => (m.replyTo?.id === id ? { ...m, replyTo: { id, deleted: true } } : m));
      if (state.replyingTo?.id === id) state.replyingTo = null;
    },
    readsLoaded(state, action) { if (state.channel) state.channel.reads = action.payload; },
    membersLoaded(state, action) { state.members = action.payload; },
  },
});
export const { opened, closed, replyStarted, replyCancelled } = slice.actions;
const { loaded, failed, received, replaced, removed, readsLoaded, membersLoaded } = slice.actions;

export const refreshRequested = createAction('chat/refreshRequested'); // fetch the open conversation again, quietly
export const messageSent = createAction('chat/messageSent');           // payload: the text
export const messageEdited = createAction('chat/messageEdited');       // payload: { id, text }
export const messageDeleted = createAction('chat/messageDeleted');     // payload: the message id
export const reactionToggled = createAction('chat/reactionToggled');   // payload: { id, emoji }
export const membersRequested = createAction('chat/membersRequested'); // payload: the space's key
export const changeRequested = createAction('chat/changeRequested');   // payload: { mutation, variables, success }

// Tells the shell that unread counts have changed, so its sidebar and bell refresh.
const refreshShell = () => emit('changed', 'chat');

function* open({ payload: id }) {
  try {
    const data = yield call(gql, OPEN, { id }); // asking for the messages also marks the conversation as read
    if ((yield select((state) => state.chat.id)) !== id) return; // the person already moved on
    yield put(loaded(data));
    yield call(refreshShell);
  } catch (err) {
    yield put(failed(err.message));
  }
}

function* markSeen() {
  const id = yield select((state) => state.chat.id);
  if (!id) return;
  try { yield call(gql, READ, { channel: id }); yield call(refreshShell); } catch { /* it stays unread; nothing is lost */ }
}
// Coming back to this tab with a conversation open: now its messages have been seen.
function* watchTabFocus() {
  const focus = eventChannel((put) => {
    const check = () => { if (!document.hidden) put(true); };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  });
  while (true) {
    yield take(focus);
    yield fork(markSeen);
  }
}

// Fetches the open conversation again without clearing what is on screen.
function* reload(id) {
  try {
    const data = yield call(gql, OPEN, { id });
    if ((yield select((state) => state.chat.id)) === id) { yield put(loaded(data)); yield call(refreshShell); }
  } catch { /* keep what is shown */ }
}

function* send({ payload: text }) {
  const { id: channel, replyingTo } = yield select((state) => state.chat);
  yield put(replyCancelled()); // the reply bar closes as soon as the message is on its way
  try {
    const { sendMessage } = yield call(gql, SEND, { channel, text, replyTo: replyingTo?.id || null });
    yield put(received(sendMessage));
  } catch (err) {
    yield call(toast, err.message);
  }
}

// Edit, react and delete all work the same way: tell the server, then show its answer.
function* edit({ payload: { id, text } }) {
  const channel = yield select((state) => state.chat.id);
  try { yield put(replaced((yield call(gql, EDIT, { channel, id, text })).message)); } catch (err) { yield call(toast, err.message); }
}
function* react({ payload: { id, emoji } }) {
  const channel = yield select((state) => state.chat.id);
  try { yield put(replaced((yield call(gql, REACT, { channel, id, emoji })).message)); } catch (err) { yield call(toast, err.message); }
}
function* remove({ payload: id }) {
  const channel = yield select((state) => state.chat.id);
  try {
    yield call(gql, DELETE, { channel, id });
    yield put(removed(id));
    yield call(toast, 'Message deleted for everyone.');
  } catch (err) {
    yield call(toast, err.message);
  }
}
// Someone read the conversation: fetch who has read up to when, so "seen" marks are right.
function* loadReads(id) {
  try { yield put(readsLoaded((yield call(gql, READS, { id })).channel.reads)); } catch { /* the marks stay as they were */ }
}

function* loadMembers({ payload: key }) {
  try { yield put(membersLoaded((yield call(gql, MEMBERS, { key })).space.project.members)); } catch { yield put(membersLoaded([])); }
}

function* change({ payload: { mutation, variables, success }, meta }) {
  let result;
  try {
    result = yield call(gql, mutation, variables);
    if (success) yield call(toast, success);
  } catch (err) {
    yield call(toast, err.message);
  }
  meta?.resolve(result);
}

// A message arrived from the server. If its conversation is open, show it and mark it as read.
function* watchServer() {
  const pushes = yield call(windowChannel, 'push');
  while (true) {
    const push = yield take(pushes);
    const id = yield select((state) => state.chat.id);
    if (push.type === 'reconnected' && id) { yield fork(reload, id); continue; } // catch up on messages missed while offline
    if (push.channelId !== id) continue; // about another conversation
    if (push.type === 'channel_deleted') { yield put(failed('This channel has been deleted.')); continue; }
    if (push.type === 'chat') { yield fork(reload, id); continue; } // its settings changed in another tab
    if (push.type === 'message_edited') yield put(replaced(push.message));
    if (push.type === 'message_deleted') yield put(removed(push.messageId));
    if (push.type === 'read') yield fork(loadReads, id);
    if (push.type !== 'message') continue;
    yield put(received(push.message));
    // It counts as read only if the person can actually see it: this tab must be the one in front.
    if (push.message.from !== session.get()?.user.id && !document.hidden) yield fork(markSeen);
  }
}

function* rootSaga() {
  yield all([
    takeLatest(opened.type, open),
    takeEvery(messageSent.type, send),
    takeLatest(refreshRequested.type, function* refresh() { const id = yield select((state) => state.chat.id); if (id) yield call(reload, id); }),
    takeEvery(messageEdited.type, edit),
    takeEvery(messageDeleted.type, remove),
    takeEvery(reactionToggled.type, react),
    takeLatest(membersRequested.type, loadMembers),
    takeEvery(changeRequested.type, change),
    fork(watchServer),
    fork(watchTabFocus),
  ]);
}

export const store = makeStore({ chat: slice.reducer }, rootSaga);
