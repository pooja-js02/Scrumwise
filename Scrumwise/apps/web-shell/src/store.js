// Redux store for the shell: what the frame itself shows — your spaces, the chat list and notifications.
// One saga also holds the live connection to the server and passes each update on to the micro-frontends.
import { createAction, createSlice } from '@reduxjs/toolkit';
import { eventChannel } from 'redux-saga';
import { all, call, cancel, fork, put, select, take, takeEvery, takeLatest } from 'redux-saga/effects';
import { emit, gql, makeStore, session, windowChannel } from '@scrumwise/ui';

const slice = createSlice({
  name: 'frame',
  initialState: {
    spaces: [],
    chatSpace: null, // the space whose channels the sidebar lists
    channels: [],
    dms: [],
    notes: { unread: 0, list: [] },
  },
  reducers: {
    spacesLoaded(state, action) { state.spaces = action.payload; },
    chatSpaceChosen(state, action) { state.chatSpace = action.payload; },
    chatLoaded(state, action) { state.channels = action.payload.channels || []; state.dms = action.payload.directMessages; },
    notesLoaded(state, action) { state.notes = action.payload; },
  },
});
export const { chatSpaceChosen } = slice.actions;
const { spacesLoaded, chatLoaded, notesLoaded } = slice.actions;

export const frameOpened = createAction('frame/opened'); // someone is logged in and the frame is on screen
export const frameClosed = createAction('frame/closed');
export const notesRead = createAction('frame/notesRead'); // payload: a notification id, or nothing for all of them

const CHANNEL = 'id project name private unread other muted hidden';
const QUERIES = {
  spaces: '{ spaces { key name hue members { user role } } }',
  chat: `query ($project: ID!) { channels(project: $project) { ${CHANNEL} } directMessages { ${CHANNEL} } }`,
  dms: `{ directMessages { ${CHANNEL} } }`,
  notes: '{ notifications { unread list { id kind text detail read at link { project channelId issueKey } } } }',
  read: 'mutation ($id: ID) { readNotifications(id: $id) }',
};

function* loadSpaces() {
  try { yield put(spacesLoaded((yield call(gql, QUERIES.spaces)).spaces)); } catch { /* keep what is shown */ }
}
function* loadChat() {
  const project = yield select((state) => state.frame.chatSpace);
  try { yield put(chatLoaded(yield call(gql, project ? QUERIES.chat : QUERIES.dms, project ? { project } : {}))); } catch { /* keep what is shown */ }
}
function* loadNotes() {
  try { yield put(notesLoaded((yield call(gql, QUERIES.notes)).notifications)); } catch { /* keep what is shown */ }
}
function* readNotes({ payload: id }) {
  try { yield call(gql, QUERIES.read, { id: id || null }); } catch { /* it stays unread */ }
  yield call(loadNotes);
}

// The live connection to the server, as a saga channel: one WebSocket per tab, straight to the gateway.
// If it drops (the server restarted, the laptop slept, the network blinked) it reconnects by itself
// within a second, forever, and reports "reconnected" so everything on screen is reloaded to catch up.
const LIVE_URL = import.meta.env.VITE_LIVE_URL || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8080/api/live`;
const serverChannel = () => eventChannel((put) => {
  let socket;
  let timer;
  let silence;
  let stopped = false;
  let wasDown = false;
  const connect = () => {
    const token = session.get()?.token;
    if (stopped || !token) return;
    const mine = new WebSocket(`${LIVE_URL}?token=${encodeURIComponent(token)}`);
    socket = mine;
    const lost = () => {
      if (socket !== mine) return; // an older connection finishing; a newer one has already taken over
      socket = null;
      clearTimeout(silence);
      mine.onclose = null;
      mine.close();
      if (!wasDown) put({ type: 'disconnected' });
      wasDown = true;
      if (!stopped) timer = setTimeout(connect, 1000);
    };
    // The server sends a heartbeat every 10 seconds. A connection can die without the browser being
    // told, so 25 seconds of silence also counts as lost.
    const heard = () => { clearTimeout(silence); silence = setTimeout(lost, 25000); };
    mine.onopen = () => { heard(); if (wasDown) { wasDown = false; put({ type: 'reconnected' }); } };
    mine.onmessage = (e) => {
      heard();
      const update = JSON.parse(e.data);
      if (update.type !== 'ping') put(update);
    };
    mine.onclose = lost;
    heard();
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); clearTimeout(silence); if (socket) { socket.onclose = null; socket.close(); } };
});
function* watchServer() {
  const updates = yield call(serverChannel);
  try {
    while (true) {
      const push = yield take(updates);
      yield call(emit, 'push', push); // the micro-frontends listen for this
      const caughtUp = push.type === 'reconnected';
      // "disconnected" also asks for notifications: if the login is no longer valid, that request logs the person out.
      if (push.type === 'notification' || push.type === 'disconnected' || caughtUp) yield fork(loadNotes);
      if (['message', 'message_deleted', 'chat', 'channel_deleted'].includes(push.type) || caughtUp) yield fork(loadChat);
      if (push.type === 'spaces' || push.type === 'chat' || caughtUp) yield fork(loadSpaces);
    }
  } finally {
    updates.close();
  }
}
// A micro-frontend changed something the frame shows (a new space, a read conversation).
function* watchMicroFrontends() {
  const changes = yield call(windowChannel, 'changed');
  try {
    while (true) {
      const what = yield take(changes);
      if (what === 'spaces') yield fork(loadSpaces);
      yield fork(loadChat);
    }
  } finally {
    changes.close();
  }
}

// Runs from log in to log out.
function* frame() {
  const watchers = yield all([fork(watchServer), fork(watchMicroFrontends)]);
  yield all([call(loadSpaces), call(loadNotes), call(loadChat)]);
  yield take(frameClosed.type);
  yield cancel(watchers);
}

function* rootSaga() {
  yield all([
    takeLatest(frameOpened.type, frame),
    takeLatest(chatSpaceChosen.type, loadChat),
    takeEvery(notesRead.type, readNotes),
  ]);
}

export const store = makeStore({ frame: slice.reducer }, rootSaga);
