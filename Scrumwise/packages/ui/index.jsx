// Shared front-end kit: the pieces every micro-frontend needs.
// Each micro-frontend bundles its own copy, so nothing here may rely on shared memory.
// State that must be shared lives in the browser (localStorage) and travels as window events.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import createSagaMiddleware, { eventChannel } from 'redux-saga';
import moment from 'moment';

// ---------- the logged-in session ----------
// Each browser tab keeps its own login (sessionStorage), so two tabs can be two different people
// and each sends as itself. The latest login is also saved for the whole browser (localStorage),
// so a new tab, or the browser reopened, starts logged in.
const KEY = 'scrumwise-session';
const OUT = 'logged-out'; // this tab logged out on purpose; do not fall back to another tab's login
const read = (store) => { try { return JSON.parse(store.getItem(KEY)); } catch { return null; } };
export const session = {
  get() {
    if (sessionStorage.getItem(KEY) === OUT) return null;
    let mine = read(sessionStorage);
    if (!mine) {
      mine = read(localStorage);
      if (mine) sessionStorage.setItem(KEY, JSON.stringify(mine)); // a new tab adopts the browser's latest login
    }
    return mine;
  },
  set(value) {
    sessionStorage.setItem(KEY, JSON.stringify(value));
    localStorage.setItem(KEY, JSON.stringify(value));
    emit('session');
  },
  clear() {
    const mine = read(sessionStorage);
    const shared = read(localStorage);
    sessionStorage.setItem(KEY, OUT);
    if (!shared || !mine || shared.user?.id === mine.user?.id) localStorage.removeItem(KEY); // leave another person's login alone
    emit('session');
  },
  // Switch account: this tab goes back to the login page; other tabs and the browser's saved login stay as they are.
  leaveTab() {
    sessionStorage.setItem(KEY, OUT);
    emit('session');
  },
};

// ---------- events between the shell and the micro-frontends ----------
// Names in use: session, navigate, changed (data changed, so lists should refresh), push (live update from the server), toast.
export const emit = (name, detail) => window.dispatchEvent(new CustomEvent(`scrumwise:${name}`, { detail }));
export function on(name, handler) {
  const listener = (e) => handler(e.detail);
  window.addEventListener(`scrumwise:${name}`, listener);
  return () => window.removeEventListener(`scrumwise:${name}`, listener);
}
export function useEvent(name, handler) {
  useEffect(() => on(name, handler)); // re-subscribed each render so the handler always sees current state
}
export const navigate = (hash) => { window.location.hash = hash; };
export const toast = (message) => emit('toast', message);

// ---------- talking to the backend (GraphQL) ----------
// Sends one GraphQL query or mutation and returns its data. Throws the server's message on failure.
export async function gql(query, variables = {}) {
  const s = session.get();
  let body;
  try {
    const res = await fetch('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    body = await res.json();
  } catch {
    throw new Error('Scrumwise could not reach the server. Check your connection and try again.');
  }
  if (body.errors?.length) {
    if (body.errors[0].extensions?.code === 'UNAUTHENTICATED' && s) session.clear(); // the login expired
    throw new Error(body.errors[0].message);
  }
  return body.data;
}

// ---------- Redux and redux-saga helpers ----------
// Each micro-frontend has its own Redux store; sagas hold everything that talks to the server.
export function makeStore(reducer, rootSaga) {
  const sagas = createSagaMiddleware();
  const store = configureStore({ reducer, middleware: (defaults) => defaults({ thunk: false, serializableCheck: false }).concat(sagas) });
  sagas.run(rootSaga);
  return store;
}
// Lets a saga listen to one of the window events above: const channel = yield call(windowChannel, 'push').
export const windowChannel = (name) => eventChannel((put) => on(name, (detail) => put(detail ?? {})));
// Dispatches an action and returns a promise the saga resolves with its result (undefined if it failed).
// Used where a component must wait, for example to close a dialog only after the change succeeded.
export const ask = (dispatch, action) => new Promise((resolve) => { dispatch({ ...action, meta: { resolve } }); });

// Runs an action and shows any error as a message instead of failing silently.
export async function attempt(action, success) {
  try {
    const result = await action();
    if (success) toast(success);
    return result;
  } catch (err) {
    toast(err.message);
    return undefined;
  }
}

// Everyone with an account, by id. Loaded once per micro-frontend.
let usersPromise;
export function useUsers() {
  const [users, setUsers] = useState({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    usersPromise ||= gql('{ users { id name email title hue } }').then((d) => Object.fromEntries(d.users.map((u) => [u.id, u]))).catch(() => { usersPromise = null; return {}; });
    let alive = true;
    usersPromise.then((map) => { if (alive) setUsers(map); });
    return () => { alive = false; };
  }, [version]);
  // Someone signed up or changed their name, or the connection came back: load the list again.
  useEvent('push', (p) => { if (p.type === 'people' || p.type === 'reconnected') { usersPromise = null; setVersion((v) => v + 1); } });
  return users;
}
export const forgetUsers = () => { usersPromise = null; };

// ---------- the contract between the shell and a micro-frontend ----------
// A micro-frontend exports `mount`. The shell calls it with an element and props, and gets back
// `update` (new props) and `unmount`. The micro-frontend's own Redux store is provided to its components.
export function createRemote(App, store) {
  return function mount(element, props) {
    const root = createRoot(element);
    const render = (p) => root.render(<Provider store={store}><App {...p} /></Provider>);
    render(props);
    return { update: render, unmount: () => root.unmount() };
  };
}

// ---------- small visual pieces ----------
const ICONS = {
  backlog: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  board: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z',
  issues: 'M4 5h16v14H4zM8 9h8M8 13h5',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  right: 'M9 6l6 6-6 6',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  theme: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 3v18M12 7l5 5M12 12l6.5 3.5M12 17l3.5 2',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.8 1.2V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.8H3a2 2 0 010-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.8-1.2V3a2 2 0 014 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.8H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  sidebar: 'M3 5h18v14H3zM9 5v14',
  filter: 'M4 6h16M7 12h10M10 18h4',
  quote: 'M10 7H6v5h3c0 2-1 3.5-3 4M19 7h-4v5h3c0 2-1 3.5-3 4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  ol: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 15h2.5L4 18.5h2.5',
  blockquote: 'M4 5v14M9 7h11M9 12h11M9 17h7',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  codeblock: 'M4 5h16v14H4zM9.5 10l-2 2 2 2M14.5 10l2 2-2 2',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  chart: 'M4 19h16M4 19V5M7 15l4-4 3 3 5-6',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h.01M14 4v4M8 10v4M16 16v4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  up: 'M6 15l6-6 6 6',
  mute: 'M18 8a6 6 0 00-9.3-5M6 8c0 7-3 9-3 9h13M13.7 21a2 2 0 01-3.4 0M3 3l18 18',
  unmute: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  hide: 'M3 3l18 18M10.7 5.1A9.6 9.6 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.3 4M6.4 6.5A17 17 0 002 12s4 7 10 7a9.6 9.6 0 004-.9M9.9 9.9a3 3 0 004.2 4.2',
  show: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  at: 'M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-3.5 7.1',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  smile: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
};
export const Icon = ({ name }) => <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;

const TYPES = {
  story: ['Story', 'M7 4h10v16l-5-4-5 4z'],
  bug: ['Bug', 'M12 7a4 4 0 014 4v3a4 4 0 01-8 0v-3a4 4 0 014-4zM4 9l4 2M20 9l-4 2M4 17l4-2M20 17l-4-2M9 4l1.5 3M15 4l-1.5 3'],
  task: ['Task', 'M5 5h14v14H5zM9 12l2.5 2.5L15.5 10'],
};
export const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v[0]]));
export const TypeIcon = ({ type }) => <span className={`itype ${type}`} title={TYPES[type]?.[0]}><svg viewBox="0 0 24 24"><path d={TYPES[type]?.[1]} /></svg></span>;

export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const PRI = { Highest: 'M6 12l6-6 6 6M6 18l6-6 6 6', High: 'M6 15l6-6 6 6', Medium: 'M6 9h12M6 15h12', Low: 'M6 9l6 6 6-6', Lowest: 'M6 6l6 6 6-6M6 12l6 6 6-6' };
export const PriIcon = ({ value }) => <svg className={`pri ${value}`} viewBox="0 0 24 24" role="img" aria-label={`${value} priority`}><title>{value} priority</title><path d={PRI[value]} /></svg>;

export const STATUSES = [
  { id: 'todo', name: 'To Do', cat: 'todo' },
  { id: 'doing', name: 'In Progress', cat: 'doing' },
  { id: 'review', name: 'In Review', cat: 'review' },
  { id: 'done', name: 'Done', cat: 'done' },
];
// A space can have its own columns; pass them as `columns`. Without them the standard four are used.
export const status = (id, columns = STATUSES) => columns.find((s) => s.id === id) || columns[0];
export const phase = (s) => (s.cat === 'review' ? 'doing' : s.cat); // not started, under way, or finished
export const statusClass = (s) => `${phase(s)} s-${s.cat}`; // the colour of a status
export function Loz({ value, columns }) {
  const s = status(value, columns);
  return <span className={`loz ${statusClass(s)}`}>{s.name}</span>;
}

const initials = (name = '') => name.split(' ').filter(Boolean).map((w) => w[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase();
export function Avatar({ user, size = '' }) {
  if (!user) return <span className={`av none ${size}`} title="Unassigned"><Icon name="user" /></span>;
  return <span className={`av ${size}`} style={{ '--h': user.hue }} title={user.name}>{initials(user.name)}</span>;
}
export const firstName = (user) => user?.name?.split(' ')[0] || 'Someone';

// ---------- dates and times (moment.js) ----------
// The server stores every moment in UTC. moment turns it into the clock of whoever is looking,
// so the same message reads "Today 2:05 PM" in Delhi and "Today 4:35 AM" in New York.
// Short form for lists: "Today 2:05 PM", "Yesterday 9:10 AM", otherwise "3 Oct 4:20 PM".
//
// By default that clock is the device's. In Settings → General a person can pick another time zone
// and a 24-hour clock; both are saved on their account and travel with the login.
let cachedPrefs;
window.addEventListener('scrumwise:session', () => { cachedPrefs = undefined; });
const prefs = () => (cachedPrefs ??= (({ timeZone = '', hour24 = false } = {}) => ({ timeZone, hour24 }))(session.get()?.user));
export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
// How many minutes a zone is ahead of UTC at a given moment (so summer time is right for that date).
const zoneParts = {};
function offsetOf(zone, date) {
  const format = (zoneParts[zone] ??= new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p = Object.fromEntries(format.formatToParts(date).map((x) => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60000);
}
// A moment on the viewer's clock.
function local(value) {
  const m = value === undefined ? moment() : moment(value);
  const { timeZone } = prefs();
  try { return timeZone ? m.utcOffset(offsetOf(timeZone, m.toDate())) : m; } catch { return m; }
}
const clock = () => (prefs().hour24 ? 'HH:mm' : 'h:mm A');
export const when = (value) => local(value).calendar(local(), {
  sameDay: `[Today] ${clock()}`, lastDay: `[Yesterday] ${clock()}`, nextDay: `[Tomorrow] ${clock()}`,
  lastWeek: `D MMM ${clock()}`, nextWeek: `D MMM ${clock()}`, sameElse: `D MMM YYYY ${clock()}`,
});
// The full version, shown when you point at a time: "Monday, 12 October 2026 at 2:05 PM (GMT+05:30)".
export const exactTime = (value) => local(value).format(`dddd, D MMMM YYYY [at] ${clock()} [(GMT]Z[)]`);
export const Time = ({ at }) => <time dateTime={moment(at).toISOString()} title={exactTime(at)}>{when(at)}</time>;

// Calendar dates (a sprint's first and last day) have no time and no zone: "2026-10-19" is that day everywhere.
const DATE = 'YYYY-MM-DD';
export const day = (date) => moment(date, DATE).format('D MMM');
export const today = () => local().format(DATE); // today on the viewer's own calendar
export const addDays = (date, n) => moment(date, DATE).add(n, 'days').format(DATE);
export const dateOf = (value) => local(value).format(DATE); // the calendar day a moment fell on, for the viewer
export const daysUntil = (date) => moment(date, DATE).diff(moment(today(), DATE), 'days');

// A centred window over the page. Closes with the cross, the Esc key, or a click outside.
export function Modal({ onClose, wide, children }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <>
      <div className="scrim open" onClick={onClose} />
      <div className={`modal open ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">{children}</div>
    </>
  );
}
export const CloseButton = ({ onClose }) => <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close"><Icon name="x" /></button>;

// Reads a form's fields into an object.
export const fields = (form) => Object.fromEntries(new FormData(form));
