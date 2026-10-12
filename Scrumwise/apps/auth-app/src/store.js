// Redux store for the log in / sign up micro-frontend.
import { createSlice } from '@reduxjs/toolkit';
import { call, put, takeLatest } from 'redux-saga/effects';
import { gql, makeStore, navigate, session } from '@scrumwise/ui';

const slice = createSlice({
  name: 'auth',
  initialState: { busy: false, error: '' },
  reducers: {
    submitted(state) { state.busy = true; state.error = ''; },
    failed(state, action) { state.busy = false; state.error = action.payload; },
    succeeded(state) { state.busy = false; },
    cleared(state) { state.error = ''; },
  },
});
export const { submitted, cleared } = slice.actions;
const { failed, succeeded } = slice.actions;

const SESSION = '{ token user { id name email title hue timeZone hour24 home } }';
const LOGIN = `mutation ($email: String!, $password: String!) { session: login(email: $email, password: $password) ${SESSION} }`;
const SIGNUP = `mutation ($name: String!, $email: String!, $password: String!) { session: signup(name: $name, email: $email, password: $password) ${SESSION} }`;

// payload: { mode: 'login' | 'signup', values: the form's fields }
function* submit({ payload: { mode, values } }) {
  try {
    const signup = mode === 'signup';
    if (signup && values.password !== values.confirm) throw new Error('The two passwords are not the same.');
    const variables = { email: values.email, password: values.password, ...(signup ? { name: values.name } : {}) };
    const { session: created } = yield call(gql, signup ? SIGNUP : LOGIN, variables);
    yield call([session, 'set'], created); // the shell hears this and shows the app
    yield put(succeeded());
    yield call(navigate, '#/'); // the shell opens the person's chosen home page
  } catch (err) {
    yield put(failed(err.message));
  }
}

function* rootSaga() {
  yield takeLatest(submitted.type, submit);
}

export const store = makeStore({ auth: slice.reducer }, rootSaga);
