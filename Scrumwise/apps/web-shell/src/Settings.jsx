// Personal settings: General, Emails and notifications, Digests. Every change is saved as it is made.
import React, { useEffect, useRef, useState } from 'react';
import { deviceZone, exactTime, gql, Icon, session, toast } from '@scrumwise/ui';

export const SETTINGS_PAGES = [
  ['general', 'General', null],
  ['notifications', 'Emails and notifications', 'Scrumwise'],
  ['digests', 'Digests', 'Scrumwise'],
];
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York']; } })();

// The sidebar while you are in settings.
export function SettingsNav({ section, home }) {
  return (
    <nav className="gnav settings-nav" aria-label="Personal settings">
      <a className="glink back" href={home}><Icon name="arrow" /><b>Personal settings</b></a>
      {SETTINGS_PAGES.map(([id, label, group], n) => (
        <React.Fragment key={id}>
          {group && group !== SETTINGS_PAGES[n - 1][2] && <p className="gsub">{group}</p>}
          <a className={`glink ${group ? 'child' : ''} ${section === id ? 'on' : ''}`} href={`#/settings/${id}`}>{label}</a>
        </React.Fragment>
      ))}
    </nav>
  );
}

const Switch = ({ checked, onChange, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><i /></button>
);
const Check = ({ checked, onChange, children, disabled, label }) => (
  <label className="tick"><input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);
// A short "Saved" beside the page title, so people know nothing more is needed.
function useSaved() {
  const [state, setState] = useState('');
  const timer = useRef();
  const run = async (work) => {
    try {
      await work();
      setState('Saved');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState(''), 1800);
    } catch (err) { toast(err.message); }
  };
  return [state && <span className="saved" role="status"><Icon name="check" />{state}</span>, run];
}
const Head = ({ title, saved }) => (
  <header className="set-head">
    <p className="crumbs"><span>Personal settings</span> <span>/</span> <span>{title}</span></p>
    <h1>{title} {saved}</h1>
  </header>
);

// ---------- General ----------
function General({ me, theme, setTheme }) {
  const [saved, run] = useSaved();
  const save = (change) => run(async () => {
    const { updateProfile } = await gql('mutation ($timeZone: String, $hour24: Boolean, $home: String) { updateProfile(timeZone: $timeZone, hour24: $hour24, home: $home) { token user { id name email title hue timeZone hour24 home } } }', change);
    session.set(updateProfile);
  });
  return (
    <section className="page settings">
      <Head title="General" saved={saved} />
      <label className="set-field">Your timezone
        <select value={me.timeZone || ''} onChange={(e) => save({ timeZone: e.target.value })}>
          <option value="">Automatic — this device ({deviceZone()})</option>
          {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
        <small>Message, comment and history times are shown on this clock. Right now it is {exactTime(new Date())}.</small>
      </label>
      <label className="set-field">Time format
        <select value={me.hour24 ? '24' : '12'} onChange={(e) => save({ hour24: e.target.value === '24' })}><option value="12">12-hour (2:05 PM)</option><option value="24">24-hour (14:05)</option></select>
      </label>
      <label className="set-field">Language
        <select disabled value="en" onChange={() => {}}><option value="en">English (United States)</option></select>
        <small>Scrumwise is available in English only for now.</small>
      </label>
      <label className="set-field">Scrumwise homepage
        <select value={me.home || 'for-you'} onChange={(e) => save({ home: e.target.value })}>
          <option value="for-you">For you</option><option value="spaces">Spaces</option><option value="board">Board of my last space</option>
        </select>
        <small>You’ll see your homepage when you log in or select the Scrumwise logo.</small>
      </label>
      <hr />
      <h2>Theme</h2>
      <div className="theme-cards" role="radiogroup" aria-label="Theme">
        {[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match browser']].map(([id, label]) => (
          <label key={id} className={`theme-card ${theme === id ? 'on' : ''}`}>
            <input type="radio" name="theme" checked={theme === id} onChange={() => run(async () => setTheme(id))} />
            <span className={`theme-art ${id}`} aria-hidden="true"><i /><i /><i /></span>{label}
          </label>
        ))}
      </div>
    </section>
  );
}

// ---------- shared: load and save the notification settings ----------
const NoEmail = ({ what = 'Emails are' }) => (
  <p className="set-note"><Icon name="info" /><span><b>{what} not sent yet.</b> This server has no mail service connected. Your choices here are saved and will apply as soon as one is set up. In-product notifications work now.</span></p>
);
function useNotificationSettings() {
  const [values, setValues] = useState(null);
  const [saved, run] = useSaved();
  useEffect(() => { gql('{ notificationSettings }').then((d) => setValues(d.notificationSettings)).catch((err) => toast(err.message)); }, []);
  // Shows the change at once, then stores it.
  const change = (input) => {
    setValues((v) => ({ ...v, ...input, ...Object.fromEntries(['email', 'emailKinds'].filter((k) => input[k]).map((k) => [k, { ...v[k], ...input[k] }])),
      ...(input.digests ? { digests: { due: { ...v.digests.due, ...input.digests.due }, weekly: { ...v.digests.weekly, ...input.digests.weekly } } } : {}) }));
    run(async () => { await gql('mutation ($input: JSON!) { setNotificationSettings(input: $input) }', { input }); });
  };
  return [values, change, saved];
}

// ---------- Emails and notifications ----------
const GROUPS = [
  ['Notifications for all issues', null, [['assigned', 'You’re assigned to an issue', true]]],
  ['Notifications for relevant issues', 'Issues you reported or are assigned to, and issues in your spaces.', [['board', 'An issue moves to another column', true], ['comment', 'Comments on your issues', true]]],
  ['Chat notifications', null, [['message', 'Someone sends you a direct message', false], ['channel', 'There is discussion in a channel you are in', false]]],
];
function Notifications({ spaces }) {
  const [v, change, saved] = useNotificationSettings();
  const [adding, setAdding] = useState(false);
  if (!v) return <section className="page settings"><Head title="Emails and notifications" /><p className="muted">Loading…</p></section>;
  const e = v.email;
  const setSpaces = (list) => change({ spaces: list });
  const free = spaces.filter((p) => !v.spaces.some((x) => x.key === p.key));
  return (
    <section className="page settings">
      <Head title="Emails and notifications" saved={saved} />
      <p>Control when you receive email or in-product notifications from Scrumwise. You can change these settings at any time.</p>

      <h2>Email preferences</h2>
      <p>Tell us what kind of email updates you want to receive, and how often we should send them.</p>
      <NoEmail />
      <div className="set-card">
        <div className="set-card-head"><b>Send me emails for issue activity</b><Switch label="Send me emails for issue activity" checked={e.on} onChange={(on) => change({ email: { on } })} /></div>
        <div className={`set-card-body ${e.on ? '' : 'off'}`}>
          <p>Receive emails when:</p>
          <Check disabled={!e.on} checked={e.assignee} onChange={(assignee) => change({ email: { assignee } })}>You’re the assignee</Check>
          <Check disabled={!e.on} checked={e.reporter} onChange={(reporter) => change({ email: { reporter } })}>You’re the reporter</Check>
          <Check disabled={!e.on} checked={e.own} onChange={(own) => change({ email: { own } })}>You make changes to issues</Check>
        </div>
      </div>
      <div className="set-card">
        <div className="set-card-head"><b>Group notification emails together</b><Switch label="Group notification emails together" checked={e.group} onChange={(group) => change({ email: { group } })} /></div>
        <div className={`set-card-body ${e.group ? '' : 'off'}`}>
          <p>We’ll group together notifications for the same issue into one email. How often do you want to receive these?</p>
          <select className="set-narrow" aria-label="How often" disabled={!e.group} value={e.every} onChange={(ev) => change({ email: { every: Number(ev.target.value) } })}>
            <option value={3}>Every 3 minutes</option><option value={10}>Every 10 minutes</option><option value={30}>Every 30 minutes</option><option value={60}>Every hour</option>
          </select>
        </div>
      </div>
      <div className="set-card">
        <div className="set-card-head"><b>Email format</b></div>
        <div className="set-card-body">
          <p>How do you like your emails?</p>
          {[['html', 'HTML'], ['text', 'Text']].map(([id, label]) => (
            <label key={id} className="tick"><input type="radio" name="format" checked={e.format === id} onChange={() => change({ email: { format: id } })} />{label}</label>
          ))}
        </div>
      </div>

      <div className="set-row-head">
        <h2>Customize space notifications</h2>
        <button className="btn" disabled={!free.length} onClick={() => setAdding(!adding)}>Add space notifications</button>
      </div>
      <p>Make your notifications specific to your space needs. Choose a space to set customized notifications.</p>
      {adding && free.length > 0 && (
        <select className="set-narrow" aria-label="Choose a space" value="" autoFocus onChange={(ev) => { setSpaces([...v.spaces, { key: ev.target.value, inApp: true, email: true }]); setAdding(false); }}>
          <option value="" disabled>Choose a space…</option>
          {free.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
        </select>
      )}
      {v.spaces.length ? (
        <table className="set-table">
          <thead><tr><th>Space</th><th>In product</th><th>Email</th><th /></tr></thead>
          <tbody>
            {v.spaces.map((x) => {
              const name = spaces.find((p) => p.key === x.key)?.name || x.key;
              const set = (part) => setSpaces(v.spaces.map((y) => (y.key === x.key ? { ...y, ...part } : y)));
              return (
                <tr key={x.key}>
                  <td><b>{name}</b><small>{x.inApp ? 'Follows your default notifications below.' : 'You get no issue, board or channel notifications from this space.'}</small></td>
                  <td><Check label={`In product, ${name}`} checked={x.inApp} onChange={(inApp) => set({ inApp })} /></td>
                  <td><Check label={`Email, ${name}`} checked={x.email} onChange={(email) => set({ email })} /></td>
                  <td><button className="icon-btn" title="Remove — use the defaults again" aria-label={`Remove ${name}`} onClick={() => setSpaces(v.spaces.filter((y) => y.key !== x.key))}><Icon name="trash" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="set-empty"><Icon name="board" /><span><b>Choose a space to get started</b><br />Don’t want to apply default notifications to all your spaces? Customize their notification settings.</span></div>
      )}

      <h2>Default notifications</h2>
      <p>Default notification settings apply across your spaces. They can be overridden by custom space notification settings.</p>
      <div className="set-groups">
        {GROUPS.map(([title, hint, rows]) => {
          const emailRows = rows.filter((r) => r[2]);
          return (
            <table className="set-table" key={title}>
              <thead>
                <tr>
                  <th>{title}{hint && <span className="hint" title={hint}><Icon name="info" /></span>}</th>
                  <th><Check checked={rows.every(([k]) => v[k])} onChange={(on) => change(Object.fromEntries(rows.map(([k]) => [k, on])))}>In product</Check></th>
                  <th>{emailRows.length > 0 && <Check checked={emailRows.every(([k]) => v.emailKinds[k])} onChange={(on) => change({ emailKinds: Object.fromEntries(emailRows.map(([k]) => [k, on])) })}>Email</Check>}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, label, email]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    <td><Check label={`In product: ${label}`} checked={v[k]} onChange={(on) => change({ [k]: on })} /></td>
                    <td>{email && <Check label={`Email: ${label}`} checked={v.emailKinds[k]} onChange={(on) => change({ emailKinds: { [k]: on } })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
      </div>
      <small>To silence a single conversation, open it and choose Mute from its “…” menu.</small>
    </section>
  );
}

// ---------- Digests ----------
function Digests() {
  const [v, change, saved] = useNotificationSettings();
  if (!v) return <section className="page settings"><Head title="Digest notifications" /><p className="muted">Loading…</p></section>;
  const { due, weekly } = v.digests;
  return (
    <section className="page settings">
      <Head title="Digest notifications" saved={saved} />
      <p>Digests are a way to see important notifications about work in your spaces.</p>
      <NoEmail what="Digests are" />
      <p>Control your digest notifications:</p>
      <div className="set-card">
        <div className="set-card-head"><b>Sprints ending soon or overdue</b><Switch label="Sprints ending soon or overdue" checked={due.on} onChange={(on) => change({ digests: { due: { on } } })} /></div>
        <div className={`set-card-body ${due.on ? '' : 'off'}`}>
          <p>Receive notifications via:</p>
          <Check disabled={!due.on} checked={due.email} onChange={(email) => change({ digests: { due: { email } } })}>Email</Check>
          <Check disabled={!due.on} checked={due.inApp} onChange={(inApp) => change({ digests: { due: { inApp } } })}>In app</Check>
        </div>
      </div>
      <div className="set-card">
        <div className="set-card-head"><b>Your weekly update</b><Switch label="Your weekly update" checked={weekly.on} onChange={(on) => change({ digests: { weekly: { on } } })} /></div>
        <div className={`set-card-body ${weekly.on ? '' : 'off'}`}>
          <p>Receive notifications via:</p>
          <Check disabled={!weekly.on} checked={weekly.email} onChange={(email) => change({ digests: { weekly: { email } } })}>Email</Check>
        </div>
      </div>
    </section>
  );
}

export function SettingsPage({ section, me, theme, setTheme, spaces }) {
  if (section === 'notifications') return <Notifications spaces={spaces} />;
  if (section === 'digests') return <Digests />;
  return <General me={me} theme={theme} setTheme={setTheme} />;
}
