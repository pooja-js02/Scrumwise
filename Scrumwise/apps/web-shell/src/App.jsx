// The shell: the page frame (top bar, sidebar, tabs), the router, and the loader for the micro-frontends.
// It owns nothing about issues or chat itself; those live in the micro-frontends it mounts.
import React, { useEffect, useRef, useState } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { Avatar, CloseButton, deviceZone, gql, Icon, Modal, navigate, session, Time, toast, useEvent, useUsers } from '@scrumwise/ui';
import { SettingsNav, SettingsPage } from './Settings.jsx';
import { chatSpaceChosen, frameClosed, frameOpened, notesRead, store } from './store.js';

const REMOTES = __REMOTES__; // set in vite.config.js

// Your profile: who you are in Scrumwise and where you work.
function Profile({ me, spaces, onEdit, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div className="dialog profile">
        <header><h2>Profile</h2><CloseButton onClose={onClose} /></header>
        <div className="profile-top"><Avatar user={me} size="lg" /><span><b>{me.name}</b><small>{me.title || 'Team member'}</small></span></div>
        <dl className="facts">
          <dt>Email</dt><dd>{me.email}</dd>
          <dt>Time zone</dt><dd>{me.timeZone ? me.timeZone.replace(/_/g, ' ') : `Automatic (${deviceZone()})`}</dd>
          <dt>Spaces</dt>
          <dd className="profile-spaces">
            {spaces.map((p) => <a key={p.key} href={`#/p/${p.key}/board`} onClick={onClose}><SpaceIcon p={p} size="xs" /><span className="grow clip">{p.name}</span><span className="loz">{p.members?.find((m) => m.user === me.id)?.role || 'Member'}</span></a>)}
            {!spaces.length && <span className="muted">You are not in any space yet.</span>}
          </dd>
        </dl>
        <footer><button className="btn subtle" onClick={onEdit}><Icon name="edit" />Edit profile</button><button className="btn primary" onClick={onClose}>Done</button></footer>
      </div>
    </Modal>
  );
}

// Your own account: name, job title and password.
function AccountSettings({ me, onClose }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const input = { name: f.name.value.trim(), title: f.title.value.trim() };
    if (f.newPassword.value) {
      if (f.newPassword.value !== f.again.value) return setError('The two new passwords are not the same.');
      Object.assign(input, { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value });
    }
    setBusy(true);
    try {
      const { updateProfile } = await gql('mutation ($name: String, $title: String, $currentPassword: String, $newPassword: String) { updateProfile(name: $name, title: $title, currentPassword: $currentPassword, newPassword: $newPassword) { token user { id name email title hue timeZone hour24 home } } }', input);
      session.set(updateProfile);
      toast(input.newPassword ? 'Account and password updated.' : 'Account updated.');
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <form className="dialog" onSubmit={submit}>
        <header><h2>Account settings</h2><CloseButton onClose={onClose} /></header>
        <label>Full name <span className="req">*</span><input name="name" required maxLength={80} defaultValue={me.name} autoComplete="name" /></label>
        <label>Job title<input name="title" maxLength={80} defaultValue={me.title || ''} autoComplete="organization-title" /></label>
        <label>Email address<input value={me.email} disabled readOnly /><small>Your email is how you log in, so it cannot be changed here.</small></label>
        <fieldset className="cols-edit">
          <legend>Change password</legend>
          <small>Leave these empty to keep your current password.</small>
          <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" /></label>
          <div className="grid2">
            <label>New password<input name="newPassword" type="password" minLength={8} autoComplete="new-password" /></label>
            <label>Repeat new password<input name="again" type="password" autoComplete="new-password" /></label>
          </div>
        </fieldset>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <footer><button type="button" className="btn subtle" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></footer>
      </form>
    </Modal>
  );
}

// Mounts a micro-frontend into the page. Its code is fetched from its own server at run time.
function Remote({ name, props }) {
  const element = useRef();
  const instance = useRef();
  const latest = useRef(props);
  const [error, setError] = useState(false);
  latest.current = props;

  useEffect(() => {
    let cancelled = false;
    setError(false);
    import(/* @vite-ignore */ REMOTES[name])
      .then((remote) => { if (!cancelled) instance.current = remote.mount(element.current, latest.current); })
      .catch((err) => { console.error(`Could not load the "${name}" micro-frontend`, err); if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      const mounted = instance.current;
      instance.current = null;
      if (mounted) setTimeout(() => mounted.unmount()); // after this render has finished
    };
  }, [name]);

  useEffect(() => { instance.current?.update(props); });

  if (error) {
    return (
      <div className="empty">
        <p><b>This part of Scrumwise could not be loaded.</b><br />The “{name}” micro-frontend is not answering at {REMOTES[name]}.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }
  return <div ref={element} className="remote" />;
}

// "#/p/PAY/board?issue=PAY-3" → { parts: ['p', 'PAY', 'board'], query: { issue: 'PAY-3' } }
function parseRoute(hash) {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(search)) };
}
function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return route;
}

const TABS = [['backlog', 'backlog', 'Backlog'], ['board', 'board', 'Board'], ['list', 'issues', 'List'], ['people', 'users', 'People'], ['chat', 'chat', 'Chat']];
const SpaceIcon = ({ p, size = '' }) => <span className={`pavatar ${size}`} style={{ '--h': p.hue }}>{p.key.slice(0, 2)}</span>;
// The key makes React create a new element when the number changes, which replays its pop animation.
const Count = ({ n }) => (n ? <span key={n} className="badge static" title={`${n} unread`}>{n}</span> : null);

function Toasts() {
  const [list, setList] = useState([]);
  useEvent('toast', (message) => {
    const id = Math.random();
    setList((l) => [...l, { id, message }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 5000);
  });
  return <div className="toasts" aria-live="polite">{list.map((t) => <div className="toast" key={t.id}><Icon name="check" /><span>{t.message}</span></div>)}</div>;
}

function Notifications({ onClose }) {
  const dispatch = useDispatch();
  const data = useSelector((state) => state.frame.notes);
  const go = (n) => {
    onClose();
    if (!n.read) dispatch(notesRead(n.id));
    const { project, channelId, issueKey } = n.link || {};
    if (issueKey) navigate(`#/p/${project}/board?issue=${issueKey}`);
    else if (channelId) navigate(project ? `#/p/${project}/chat/${channelId}` : `#/dm/${channelId}`);
  };
  const icon = { message: 'chat', channel: 'hash', board: 'board', issue: 'issues' };
  return (
    <Modal onClose={onClose}>
      <div className="dialog">
        <header><h2>Notifications</h2><CloseButton onClose={onClose} /></header>
        <div className="notes">
          {data.list.map((n) => (
            <button className={`note ${n.read ? '' : 'unread'}`} key={n.id} onClick={() => go(n)}>
              <span className="note-ico"><Icon name={icon[n.kind]} /></span>
              <span className="grow"><b>{n.text}</b><span className="note-detail">{n.detail}</span><small><Time at={n.at} /></small></span>
              {!n.read && <span className="dot" title="New" />}
            </button>
          ))}
          {!data.list.length && <p className="muted">You have no notifications.</p>}
        </div>
        {data.unread > 0 && <footer><button className="btn subtle" onClick={() => dispatch(notesRead())}>Mark all as read</button></footer>}
      </div>
    </Modal>
  );
}

// The page a person lands on after logging in or pressing the logo (Settings → General → homepage).
const homeOf = (user, lastSpace) => (user?.home === 'spaces' ? '#/spaces' : user?.home === 'board' && lastSpace ? `#/p/${lastSpace}/board` : '#/for-you');

function Frame({ me, route }) {
  const users = useUsers();
  const dispatch = useDispatch();
  const { spaces, channels, dms, notes } = useSelector((state) => state.frame);
  const [sideOpen, setSideOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [account, setAccount] = useState(false);
  const [profile, setProfile] = useState(false);
  const [themes, setThemes] = useState(false); // the Theme choices inside the avatar menu
  const [gear, setGear] = useState(false);
  const [find, setFind] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('scrumwise-theme') || 'light'); // 'light' | 'dark' | 'system'
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const shown = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  const [first, key, tab = 'backlog', channelId] = route.parts;
  const inSpace = first === 'p' && key;
  // The chat list in the sidebar belongs to the space you are in, or were last in.
  const [lastKey, setLastKey] = useState(() => localStorage.getItem('scrumwise-space') || '');
  useEffect(() => { if (inSpace) { setLastKey(key); localStorage.setItem('scrumwise-space', key); } }, [inSpace, key]);
  const chatKey = inSpace ? key : spaces.some((p) => p.key === lastKey) ? lastKey : spaces[0]?.key;
  const space = spaces.find((p) => p.key === (inSpace ? key : chatKey));

  // The sagas in store.js load the data and keep it fresh; this component only says what it needs.
  useEffect(() => {
    dispatch(frameOpened());
    return () => { dispatch(frameClosed()); };
  }, [dispatch]);
  useEffect(() => { dispatch(chatSpaceChosen(chatKey || null)); }, [dispatch, chatKey]);

  useEffect(() => { document.documentElement.dataset.theme = shown; localStorage.setItem('scrumwise-theme', theme); }, [theme, shown]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = (e) => setSystemDark(e.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const inSettings = first === 'settings';
  const home = homeOf(me, lastKey);
  useEffect(() => {
    if (!menu && !gear) return undefined;
    const close = () => { setMenu(false); setGear(false); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu, gear]);

  // Hidden conversations stay out of the list unless you ask for them (or have one open).
  const listed = (list) => list.filter((c) => !c.hidden || showHidden || c.id === openChat);
  const hiddenCount = [...channels, ...dms].filter((c) => c.hidden).length;
  // A muted conversation is dimmed, shows a crossed bell, and never shouts about unread messages.
  const convClass = (c) => `conv ${openChat === c.id ? 'on' : ''} ${c.unread && !c.muted ? 'unread' : ''} ${c.muted ? 'muted' : ''} ${c.hidden ? 'is-hidden' : ''}`;
  const convTail = (c) => (c.muted ? <span className="conv-muted" title="Muted"><Icon name="mute" /></span> : <Count n={c.unread} />);
  const hit = (name = '') => !find.trim() || name.toLowerCase().includes(find.trim().toLowerCase());
  const openChat = first === 'dm' ? key : inSpace && tab === 'chat' ? channelId : null;
  const firstChannel = channels[0]?.id;

  // Which micro-frontend fills the page, and with what.
  let page;
  if (inSettings) page = <SettingsPage section={key || 'general'} me={me} theme={theme} setTheme={setTheme} spaces={spaces} />;
  else if (first === 'dm') page = <Remote name="chat" props={{ channelId: key }} />;
  else if (inSpace && tab === 'chat') page = <Remote name="chat" props={{ projectKey: key, channelId: channelId || firstChannel }} />;
  else if (inSpace) page = <Remote name="work" props={{ view: tab, projectKey: key, query: route.query }} />;
  else page = <Remote name="work" props={{ view: first === 'spaces' ? 'spaces' : 'for-you', query: route.query }} />;

  return (
    <div className={`app ${sideOpen ? '' : 'side-closed'}`}>
      <header className="topnav">
        <div className="top-left">
          <button className="icon-btn sq" onClick={() => setSideOpen(!sideOpen)} title="Show or hide the sidebar" aria-label="Show or hide the sidebar"><Icon name="sidebar" /></button>
          <a className="brand" href={home} aria-label="Scrumwise home"><img src="/images/logo.jpg" alt="Scrumwise" className="brand-logo" /></a>
        </div>
        <div className="top-mid">
          <span className="spacer" />
          <button className="btn primary" disabled={!space} title={space ? `Create an issue in ${space.name}` : 'Create a space first'} onClick={() => navigate(`#/p/${space.key}/${inSpace && tab !== 'chat' ? tab : 'backlog'}?create=1`)}><Icon name="plus" />Create issue</button>
        </div>
        <div className="top-right">
          <button className="icon-btn bell" onClick={() => setBell(true)} aria-label="Notifications" title={notes.unread ? `${notes.unread} new notifications` : 'Notifications'}>
            <Icon name="bell" />{notes.unread > 0 && <span className="badge" key={notes.unread}>{notes.unread}</span>}
          </button>
          <button className={`icon-btn ${gear ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); setMenu(false); setGear(!gear); }} title="Settings" aria-label="Settings" aria-expanded={gear}><Icon name="gear" /></button>
          <span className="me" role="button" tabIndex={0} title="Your account" onClick={(e) => { e.stopPropagation(); setGear(false); setMenu(!menu); }}><Avatar user={me} /></span>
        </div>
        <div className={`user-menu settings-menu ${gear ? 'open' : ''}`} role="menu">
          <p className="menu-title">Personal settings</p>
          <button role="menuitem" onClick={() => navigate('#/settings/general')}><Icon name="user" /><span><b>General settings</b><small>Manage language, time zone, and other personal preferences</small></span></button>
          <button role="menuitem" onClick={() => navigate('#/settings/notifications')}><Icon name="bell" /><span><b>Notification settings</b><small>Manage email and in-app notifications from Scrumwise</small></span></button>
        </div>
        <div className={`user-menu ${menu ? 'open' : ''}`} role="menu">
          <div className="user-menu-head"><Avatar user={me} size="lg" /><span><b>{me.name}</b><small>{me.email}</small></span></div>
          <button role="menuitem" onClick={() => setProfile(true)}><Icon name="user" />Profile</button>
          <button role="menuitem" onClick={() => setAccount(true)}><Icon name="gear" />Account settings</button>
          <button role="menuitem" aria-haspopup="true" aria-expanded={themes} onClick={(e) => { e.stopPropagation(); setThemes(!themes); }}><Icon name="theme" /><span className="grow">Theme</span><Icon name={themes ? 'down' : 'right'} /></button>
          {themes && [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match browser']].map(([id, label]) => (
            <button key={id} role="menuitemradio" aria-checked={theme === id} className="sub-item" onClick={(e) => { e.stopPropagation(); setTheme(id); }}><span className="grow">{label}</span>{theme === id && <Icon name="check" />}</button>
          ))}
          <hr />
          <button role="menuitem" title="Log in as someone else in this tab. Your other tabs stay logged in." onClick={() => { session.leaveTab(); navigate('#/login'); }}><Icon name="users" />Switch account</button>
          <button role="menuitem" onClick={() => { session.clear(); navigate('#/login'); }}><Icon name="logout" />Log out</button>
        </div>
      </header>

      <div className="body">
        <aside className="side" aria-label="Navigation">
          {inSettings && <SettingsNav section={key || 'general'} home={home} />}
          <nav className="gnav" hidden={inSettings}>
            <a className={`glink ${first === 'for-you' || !first ? 'on' : ''}`} href="#/for-you"><Icon name="user" />For you</a>
            <div className="glink static"><Icon name="board" /><span className="grow">Spaces</span><a className="icon-btn" href="#/spaces?create=1" title="Create space" aria-label="Create space"><Icon name="plus" /></a></div>
            {spaces.map((p) => (
              <a key={p.key} className={`glink child ${inSpace && p.key === key ? 'on' : ''}`} href={`#/p/${p.key}/${inSpace && tab !== 'chat' ? tab : 'backlog'}`}><SpaceIcon p={p} size="xs" /><span className="clip grow">{p.name}</span></a>
            ))}
            <a className={`glink child ${first === 'spaces' ? 'on' : ''}`} href="#/spaces"><Icon name="backlog" /><span className="grow">All spaces</span><Icon name="right" /></a>
          </nav>

          <div className="chat-nav" hidden={inSettings}>
            <p className="gsub">Chat{space ? ` · ${space.name}` : ''}</p>
            <label className="search-in find"><Icon name="search" /><input placeholder="Find a conversation…" aria-label="Find a conversation" value={find} onChange={(e) => setFind(e.target.value)} /></label>
            <div className="conv-head"><Icon name="hash" /><span className="grow">Channels</span>
              {chatKey && <a className="icon-btn" href={`#/p/${chatKey}/chat/new-channel`} title="Create a channel" aria-label="Create a channel"><Icon name="plus" /></a>}
            </div>
            {listed(channels).filter((c) => hit(c.name)).map((c) => (
              <a key={c.id} className={convClass(c)} href={`#/p/${c.project}/chat/${c.id}`}>
                <span className="conv-ico"><Icon name={c.private ? 'lock' : 'hash'} /></span><span className="clip grow">{c.name}</span>{convTail(c)}
              </a>
            ))}
            {!listed(channels).length && <p className="conv-empty">{chatKey ? 'No channels yet' : 'Join or create a space first'}</p>}
            <div className="conv-head"><Icon name="chat" /><span className="grow">Direct messages</span><a className="icon-btn" href="#/dm/new-dm" title="New message" aria-label="New message"><Icon name="plus" /></a></div>
            {listed(dms).filter((c) => hit(users[c.other]?.name)).map((c) => (
              <a key={c.id} className={convClass(c)} href={`#/dm/${c.id}`}>
                <span className="conv-ico"><Avatar user={users[c.other]} size="xs" /></span><span className="clip grow">{users[c.other]?.name || '…'}</span>{convTail(c)}
              </a>
            ))}
            {!listed(dms).length && <p className="conv-empty">No messages yet</p>}
            {hiddenCount > 0 && (
              <button className="conv hidden-toggle" onClick={() => setShowHidden(!showHidden)} aria-expanded={showHidden}>
                <span className="conv-ico"><Icon name={showHidden ? 'hide' : 'show'} /></span>
                <span className="grow">{showHidden ? 'Stop showing hidden' : `Show ${hiddenCount} hidden`}</span>
              </button>
            )}
          </div>
        </aside>

        <main id="view" className={inSpace ? 'in-project' : ''}>
          {inSpace && space && (
            <div className="phead">
              <p className="crumbs"><a href="#/spaces">Spaces</a></p>
              <div className="phead-row"><SpaceIcon p={space} size="sm" /><h1>{space.name}</h1></div>
              <nav className="ptabs" aria-label={space.name}>
                {TABS.map(([v, icon, label]) => <a key={v} className={tab === v ? 'on' : ''} href={`#/p/${key}/${v}`}><Icon name={icon} />{label}</a>)}
              </nav>
            </div>
          )}
          {page}
        </main>
      </div>

      {bell && <Notifications onClose={() => setBell(false)} />}
      {profile && <Profile me={me} spaces={spaces} onEdit={() => { setProfile(false); setAccount(true); }} onClose={() => setProfile(false)} />}
      {account && <AccountSettings me={me} onClose={() => setAccount(false)} />}
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [current, setCurrent] = useState(() => session.get());
  useEvent('session', () => setCurrent(session.get()));
  const authPage = route.parts[0] === 'login' || route.parts[0] === 'signup';

  // Nothing is reachable before logging in.
  useEffect(() => {
    if (!current && !authPage) navigate('#/login');
    if (current && (authPage || !route.parts.length)) navigate(homeOf(current.user, localStorage.getItem('scrumwise-space')));
  }, [current, authPage, route.parts.length]);

  return (
    <Provider store={store}>
      {current && !authPage
        ? <Frame me={current.user} route={route} key={current.user.id} />
        : <Remote name="auth" props={{ mode: route.parts[0] === 'signup' ? 'signup' : 'login' }} />}
      <Toasts />
    </Provider>
  );
}
