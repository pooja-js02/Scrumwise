// Redux store for the work micro-frontend. Components read state and dispatch actions;
// the sagas below are the only place that talks to the server.
import { createAction, createSlice } from '@reduxjs/toolkit';
import { all, call, fork, put, select, take, takeEvery, takeLatest } from 'redux-saga/effects';
import { gql, makeStore, toast, windowChannel } from '@scrumwise/ui';
import { Q } from './graphql.js';

const slice = createSlice({
  name: 'work',
  initialState: {
    spaces: null, // every space you belong to; null while loading
    mine: null,   // open issues assigned to you
    key: null,    // the space that is open
    data: null,   // that space's { project, sprints, issues }
    error: '',
  },
  reducers: {
    spacesLoaded(state, action) { state.spaces = action.payload; },
    mineLoaded(state, action) { state.mine = action.payload; },
    spaceOpened(state, action) {
      if (state.key !== action.payload) { state.key = action.payload; state.data = null; }
      state.error = '';
    },
    spaceLoaded(state, action) { state.data = action.payload; state.error = ''; },
    spaceFailed(state, action) { state.error = action.payload; },
  },
});
export const { spaceOpened } = slice.actions;
const { spacesLoaded, mineLoaded, spaceLoaded, spaceFailed } = slice.actions;

export const spacesRequested = createAction('work/spacesRequested');
export const mineRequested = createAction('work/mineRequested');
// A change to send to the server: { mutation, variables, success } — success is the message to show afterwards.
export const changeRequested = createAction('work/changeRequested');

function* loadSpaces() {
  try { yield put(spacesLoaded((yield call(gql, Q.spaces)).spaces)); } catch { yield put(spacesLoaded([])); }
}
function* loadMine() {
  try { yield put(mineLoaded((yield call(gql, Q.mine)).myIssues)); } catch { yield put(mineLoaded([])); }
}
function* loadSpace() {
  const key = yield select((state) => state.work.key);
  if (!key) return;
  try {
    const { space } = yield call(gql, Q.space, { key });
    if ((yield select((state) => state.work.key)) === key) yield put(spaceLoaded(space)); // ignore an answer for a space we already left
  } catch (err) {
    yield put(spaceFailed(err.message));
  }
}

// Sends one change, tells the person how it went, then reloads the open space so the page shows the truth.
function* change({ payload: { mutation, variables, success }, meta }) {
  let result;
  try {
    result = yield call(gql, mutation, variables);
    if (success) yield call(toast, success);
  } catch (err) {
    yield call(toast, err.message);
  }
  yield call(loadSpace);
  meta?.resolve(result);
}

// Someone else changed something: the server pushed an update through the shell.
function* watchServer() {
  const pushes = yield call(windowChannel, 'push');
  while (true) {
    const push = yield take(pushes);
    const { key, mine, spaces } = yield select((state) => state.work);
    const caughtUp = push.type === 'reconnected'; // the live connection was down: reload everything on screen
    if (((push.type === 'board' || push.type === 'spaces') && push.project === key) || (caughtUp && key)) yield fork(loadSpace);
    if ((push.type === 'board' || caughtUp) && mine) yield fork(loadMine);
    if ((push.type === 'spaces' || caughtUp) && spaces) yield fork(loadSpaces);
  }
}

function* rootSaga() {
  yield all([
    takeLatest(spaceOpened.type, loadSpace),
    takeLatest(spacesRequested.type, loadSpaces),
    takeLatest(mineRequested.type, loadMine),
    takeEvery(changeRequested.type, change),
    fork(watchServer),
  ]);
}

export const store = makeStore({ work: slice.reducer }, rootSaga);
