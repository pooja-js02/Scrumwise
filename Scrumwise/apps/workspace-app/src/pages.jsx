import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ask, Avatar, CloseButton, emit, fields, Icon, Loz, Modal, navigate, PriIcon, TYPE_NAMES, TypeIcon, useUsers } from '@scrumwise/ui';
import { M } from './graphql.js';
import { changeRequested, mineRequested, spacesRequested } from './store.js';

const ROLES = ['Administrator', 'Member', 'Viewer', 'Client'];
const SpaceIcon = ({ p, size = '' }) => <span className={`pavatar ${size}`} style={{ '--h': p.hue }}>{p.key.slice(0, 2)}</span>;

// The spaces you belong to, from the store. Asks the saga to load them when the page opens.
function useSpaces() {
  const dispatch = useDispatch();
  const spaces = useSelector((state) => state.work.spaces);
  useEffect(() => { dispatch(spacesRequested()); }, [dispatch]);
  return spaces;
}

// ---------- For you: your issues in every space ----------
export function ForYou() {
  const dispatch = useDispatch();
  const spaces = useSpaces();
  const mine = useSelector((state) => state.work.mine);
  useEffect(() => { dispatch(mineRequested()); }, [dispatch]);
  const groups = [['In progress', (i) => i.status !== 'todo'], ['To do', (i) => i.status === 'todo']];
  return (
    <section className="page narrow">
      <h1>For you</h1>
      <h2 className="sub">Your spaces</h2>
      <div className="pcards">
        {(spaces || []).map((p) => (
          <div className="pcard" style={{ '--h': p.hue }} key={p.key}>
            <a className="pcard-main" href={`#/p/${p.key}/board`}><SpaceIcon p={p} /><span><b>{p.name}</b><small>Software project</small></span></a>
            <p className="pcard-line"><span>My open issues</span><span className="count">{(mine || []).filter((i) => i.project === p.key).length}</span></p>
            <p className="pcard-links"><a className="link" href={`#/p/${p.key}/board`}>Board</a><a className="link" href={`#/p/${p.key}/backlog`}>Backlog</a></p>
          </div>
        ))}
        {spaces && !spaces.length && <p className="muted">You are not in any space yet. <a className="link" href="#/spaces?create=1">Create one</a>.</p>}
      </div>
      <h2 className="sub">Assigned to me <span className="count">{mine?.length ?? 0}</span></h2>
      {mine && !mine.length && <p className="empty">Nothing is assigned to you.</p>}
      {groups.map(([label, test]) => {
        const list = (mine || []).filter(test);
        return list.length > 0 && (
          <React.Fragment key={label}>
            <p className="group-label">{label}</p>
            <div className="list">
              {list.map((i) => (
                <a className="trow" key={i.key} href={`#/p/${i.project}/board?issue=${i.key}`}>
                  <TypeIcon type={i.type} /><span className="trow-title">{i.title}<small>{i.key} · {i.projectName}</small></span><PriIcon value={i.priority} /><Loz value={i.status} columns={[{ id: i.status, name: i.statusName, cat: i.statusCat }]} />
                </a>
              ))}
            </div>
          </React.Fragment>
        );
      })}
    </section>
  );
}

// ---------- Spaces: every space you belong to ----------
export function Spaces({ create }) {
  const dispatch = useDispatch();
  const spaces = useSpaces();
  const users = useUsers();
  const [key, setKey] = useState('');
  const [touched, setTouched] = useState(false);
  const suggest = (name) => name.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean).map((w, _i, a) => (a.length === 1 ? w.slice(0, 3) : w[0])).join('').slice(0, 5);
  const close = () => navigate('#/spaces');
  const submit = async (e) => {
    e.preventDefault();
    const { name, key: chosen } = fields(e.target);
    const created = await ask(dispatch, changeRequested({ mutation: M.createSpace, variables: { name, key: chosen }, success: 'Space created.' }));
    if (!created) return;
    emit('changed', 'spaces'); // the shell's sidebar lists spaces too
    dispatch(spacesRequested());
    navigate(`#/p/${created.createSpace.key}/backlog`);
  };
  return (
    <section className="page">
      <header className="page-head"><h1>Spaces</h1><a className="btn primary" href="#/spaces?create=1">Create space</a></header>
      <table className="table">
        <thead><tr><th>Name</th><th>Key</th><th>Type</th><th>Lead</th><th>Issues</th></tr></thead>
        <tbody>
          {(spaces || []).map((p) => (
            <tr className="click" key={p.key} tabIndex={0} onClick={() => navigate(`#/p/${p.key}/backlog`)}>
              <td><span className="pname" style={{ '--h': p.hue }}><SpaceIcon p={p} size="sm" /><b>{p.name}</b></span></td>
              <td>{p.key}</td><td>Software project</td>
              <td><span className="who"><Avatar user={users[p.lead]} size="sm" />{users[p.lead]?.name}</span></td>
              <td>{p.issueCount}</td>
            </tr>
          ))}
          {spaces && !spaces.length && <tr><td colSpan={5} className="muted">You are not in any space yet.</td></tr>}
        </tbody>
      </table>
      {create && (
        <Modal onClose={close}>
          <form className="dialog" onSubmit={submit}>
            <header><h2>Create space</h2><CloseButton onClose={close} /></header>
            <label>Name <span className="req">*</span><input name="name" required autoComplete="off" autoFocus placeholder="For example: Marketing Website" onChange={(e) => !touched && setKey(suggest(e.target.value))} /></label>
            <label>Key <span className="req">*</span><input name="key" required autoComplete="off" maxLength={5} placeholder="For example: WEB" value={key} onChange={(e) => { setTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); }} /></label>
            <p className="muted small">The key is the prefix of every issue in the space, for example WEB-12.</p>
            <footer><button type="button" className="btn subtle" onClick={close}>Cancel</button><button className="btn primary">Create</button></footer>
          </form>
        </Modal>
      )}
    </section>
  );
}

// ---------- List: every issue in the space, with filters ----------
export function List({ data, users, open }) {
  const [f, setF] = useState({ q: '', type: '', status: '', who: '' });
  const set = (name) => (e) => setF({ ...f, [name]: e.target.value });
  const q = f.q.trim().toLowerCase();
  const list = data.issues.filter((i) => (!q || `${i.key} ${i.title}`.toLowerCase().includes(q)) && (!f.type || i.type === f.type) && (!f.status || i.status === f.status)
    && (!f.who || (f.who === 'none' ? !i.assignee : i.assignee === f.who)));
  const sprint = (id) => data.sprints.find((s) => s.id === id)?.name || '—';
  return (
    <section className="page wide">
      <div className="filters">
        <label className="search-in"><Icon name="search" /><input placeholder="Search issues" aria-label="Search issues" value={f.q} onChange={set('q')} /></label>
        <select aria-label="Type" value={f.type} onChange={set('type')}><option value="">Type: All</option>{Object.entries(TYPE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select aria-label="Status" value={f.status} onChange={set('status')}><option value="">Status: All</option>{data.project.columns.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select aria-label="Assignee" value={f.who} onChange={set('who')}><option value="">Assignee: All</option><option value="none">Unassigned</option>{data.project.members.map((m) => <option key={m.user} value={m.user}>{users[m.user]?.name}</option>)}</select>
      </div>
      <table className="table">
        <thead><tr><th>Type</th><th>Key</th><th>Summary</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Sprint</th></tr></thead>
        <tbody>
          {list.map((i) => (
            <tr className="click" key={i.key} tabIndex={0} onClick={() => open(i.key)}>
              <td><TypeIcon type={i.type} /></td><td className="tid">{i.key}</td><td>{i.title}</td>
              <td><span className="who"><Avatar user={users[i.assignee]} size="sm" />{users[i.assignee]?.name || 'Unassigned'}</span></td>
              <td><span className="who"><PriIcon value={i.priority} />{i.priority}</span></td><td><Loz value={i.status} columns={data.project.columns} /></td><td>{sprint(i.sprint)}</td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={7} className="muted">No issues match these filters.</td></tr>}
        </tbody>
      </table>
      <p className="muted small">{list.length} of {data.issues.length} issues</p>
    </section>
  );
}

// ---------- People: who is in the space and what they may do ----------
export function People({ data, users, me, act, role }) {
  const [adding, setAdding] = useState(false);
  const admin = role === 'Administrator';
  const key = data.project.key;
  const outside = Object.values(users).filter((u) => !data.project.members.some((m) => m.user === u.id));
  const changed = () => emit('changed', 'chat'); // members also join or leave the space's channels
  const add = async (e) => {
    e.preventDefault();
    const { userId, role: chosen } = fields(e.target);
    await act(M.addMember, { space: key, user: userId, role: chosen }, 'Person added to the space.');
    changed();
    setAdding(false);
  };
  return (
    <section className="page">
      <header className="page-head"><h1>People</h1>{admin && <button className="btn primary" onClick={() => setAdding(true)}>Add people</button>}</header>
      <p className="muted">Administrators can add people and change roles. Members can create and edit issues. Viewers can only look. A Client is the owner of the product: they can follow progress, comment and talk to the team in chat.</p>
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
        <tbody>
          {data.project.members.map((m) => (
            <tr key={m.user}>
              <td><span className="who"><Avatar user={users[m.user]} size="sm" /><b>{users[m.user]?.name || '…'}</b>{m.user === me.id && <span className="loz todo">You</span>}</span></td>
              <td>{users[m.user]?.email}</td>
              <td>
                <select aria-label={`Role for ${users[m.user]?.name}`} value={m.role} disabled={!admin || m.user === me.id}
                  onChange={(e) => act(M.setMemberRole, { space: key, user: m.user, role: e.target.value }, 'Role changed.')}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
              </td>
              <td className="right">
                {m.user !== me.id && <button className="btn subtle" onClick={() => act(M.openDirectMessage, { user: m.user }).then((d) => d && navigate(`#/dm/${d.openDirectMessage.id}`))}><Icon name="chat" />Message</button>}
                {admin && m.user !== me.id && <button className="btn subtle" onClick={async () => { if (window.confirm(`Remove ${users[m.user]?.name} from this space? Their issues will become unassigned.`)) { await act(M.removeMember, { space: key, user: m.user }, 'Person removed.'); changed(); } }}>Remove</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <form className="dialog" onSubmit={add}>
            <header><h2>Add people to {data.project.name}</h2><CloseButton onClose={() => setAdding(false)} /></header>
            {outside.length ? <>
              <label>Person <span className="req">*</span><select name="userId" required>{outside.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}</select></label>
              <label>Role<select name="role" defaultValue="Member">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
              <p className="muted small">People appear here once they have signed up for Scrumwise.</p>
              <footer><button type="button" className="btn subtle" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary">Add</button></footer>
            </> : <p className="muted">Everyone who has an account is already in this space. Ask new people to sign up first.</p>}
          </form>
        </Modal>
      )}
    </section>
  );
}
