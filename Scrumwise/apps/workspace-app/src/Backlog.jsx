import React, { useState } from 'react';
import { addDays, Avatar, CloseButton, day, fields, Icon, Modal, phase, status, statusClass, today, TypeIcon } from '@scrumwise/ui';
import { M } from './graphql.js';

const points = (list) => list.reduce((n, i) => n + (Number(i.points) || 0), 0);

// The search box, assignee avatars and quick filter shared by the Backlog and the Board.
export function useFilters(me) {
  const [f, setF] = useState({ q: '', who: [], mine: false });
  const match = (i) => (!f.q.trim() || `${i.key} ${i.title}`.toLowerCase().includes(f.q.trim().toLowerCase()))
    && (!f.who.length || f.who.includes(i.assignee)) && (!f.mine || i.assignee === me.id);
  return { f, setF, match, active: !!(f.q || f.who.length || f.mine) };
}
export function FilterBar({ filters: { f, setF, active }, people, users, placeholder }) {
  const toggle = (id) => setF({ ...f, who: f.who.includes(id) ? f.who.filter((x) => x !== id) : [...f.who, id] });
  return (
    <div className="filters">
      <label className="search-in"><Icon name="search" /><input placeholder={placeholder} aria-label={placeholder} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
      <span className="avs">{people.map((id) => <button key={id} className={`av-btn ${f.who.includes(id) ? 'on' : ''}`} aria-pressed={f.who.includes(id)} onClick={() => toggle(id)}><Avatar user={users[id]} /></button>)}</span>
      <button className={`btn outline ${f.mine ? 'on' : ''}`} aria-pressed={f.mine} onClick={() => setF({ ...f, mine: !f.mine })}><Icon name="filter" />Only my issues</button>
      {active && <button className="btn subtle" onClick={() => setF({ q: '', who: [], mine: false })}>Clear filters</button>}
    </div>
  );
}

export function Backlog({ data, users, me, act, open, canEdit }) {
  const { project, sprints, issues } = data;
  const filters = useFilters(me);
  const [collapsed, setCollapsed] = useState([]);
  const [dialog, setDialog] = useState(null); // 'sprint' or { finish: sprint }
  const current = sprints.find((s) => s.state === 'active');
  const planned = sprints.filter((s) => s.state === 'planned');
  const openSprints = sprints.filter((s) => s.state !== 'done');
  const patch = (issue, input, message) => act(M.updateIssue, { key: issue.key, input }, message);

  const section = (sprint) => {
    const id = sprint?.id || 'backlog';
    const all = issues.filter((i) => (sprint ? i.sprint === sprint.id : !i.sprint));
    const list = all.filter(filters.match);
    const by = (cat) => points(all.filter((i) => phase(status(i.status, project.columns)) === cat));
    const isOpen = !collapsed.includes(id);
    const quick = (e) => {
      e.preventDefault();
      const title = e.target.title.value.trim();
      if (!title) return;
      e.target.reset();
      act(M.createIssue, { space: project.key, input: { title, sprint: sprint?.id || null } });
    };
    return (
      <div className="bsec" key={id}>
        <div className="bsec-head">
          <button className="icon-btn sq" aria-expanded={isOpen} title={isOpen ? 'Collapse' : 'Expand'} onClick={() => setCollapsed(isOpen ? [...collapsed, id] : collapsed.filter((x) => x !== id))}><Icon name={isOpen ? 'down' : 'right'} /></button>
          <b>{sprint ? sprint.name : 'Backlog'}</b>
          <span className="muted">{sprint ? `${day(sprint.start)} – ${day(sprint.end)} ` : ''}({all.length} {all.length === 1 ? 'issue' : 'issues'})</span>
          <span className="spacer" />
          <span className="pt todo" title={`Not started: ${by('todo')} points`}>{by('todo')}</span>
          <span className="pt doing" title={`In progress: ${by('doing')} points`}>{by('doing')}</span>
          <span className="pt done" title={`Done: ${by('done')} points`}>{by('done')}</span>
          {canEdit && (!sprint ? <button className="btn outline" onClick={() => setDialog('sprint')}>Create sprint</button>
            : sprint.state === 'active' ? <button className="btn outline" onClick={() => setDialog({ finish: sprint })}>Complete sprint</button>
            : <>
              <button className={`btn ${current ? 'outline' : 'primary'}`} disabled={!!current} title={current ? 'Complete the active sprint first' : ''} onClick={() => act(M.startSprint, { id: sprint.id }, `${sprint.name} has started.`)}>Start sprint</button>
              <button className="icon-btn sq" title="Delete sprint" aria-label="Delete sprint" onClick={() => act(M.deleteSprint, { id: sprint.id }, `${sprint.name} deleted.`)}><Icon name="x" /></button>
            </>)}
        </div>
        {sprint?.goal && isOpen && <p className="bsec-goal">{sprint.goal}</p>}
        {isOpen && <>
          <div className="blist">
            {list.map((i) => {
              const targets = [...openSprints.filter((s) => s.id !== i.sprint).map((s) => [s.id, s.name]), ...(i.sprint ? [['', 'Backlog']] : [])];
              return (
                <div className="trow" key={i.key} tabIndex={0} onClick={() => open(i.key)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open(i.key)}>
                  <TypeIcon type={i.type} /><span className={`tid ${i.status === 'done' ? 'struck' : ''}`}>{i.key}</span>
                  <span className="trow-title">{i.title}</span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: 'contents' }}>
                    <select className={`status-pill ${statusClass(status(i.status, project.columns))}`} aria-label={`Status of ${i.key}`} value={i.status} disabled={!canEdit} onChange={(e) => patch(i, { status: e.target.value })}>
                      {project.columns.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {canEdit && targets.length > 0 && (
                      <select className="move" aria-label={`Move ${i.key} to`} value="move" onChange={(e) => patch(i, { sprint: e.target.value || null })}>
                        <option value="move" disabled>Move to</option>
                        {targets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    )}
                  </span>
                  <span className={`pts ${i.points ? '' : 'none'}`} title="Story points">{i.points ?? '–'}</span><Avatar user={users[i.assignee]} size="sm" />
                </div>
              );
            })}
            {!list.length && <p className="blist-empty">{all.length ? 'No issues match the filters.' : sprint ? 'Plan this sprint by moving issues here with the “Move to” menu.' : 'Your backlog is empty.'}</p>}
          </div>
          {canEdit && <form className="quick" onSubmit={quick}><Icon name="plus" /><input name="title" placeholder="Create" aria-label={`Create issue in ${sprint ? sprint.name : 'Backlog'}`} autoComplete="off" /></form>}
        </>}
      </div>
    );
  };

  return (
    <section className="page wide">
      <FilterBar filters={filters} users={users} people={[...new Set(issues.map((i) => i.assignee).filter(Boolean))]} placeholder="Search backlog" />
      {current && section(current)}
      {planned.map(section)}
      {section(null)}

      {dialog === 'sprint' && <SprintDialog project={project} sprints={sprints} onClose={() => setDialog(null)} act={act} />}
      {dialog?.finish && <FinishSprint sprint={dialog.finish} issues={issues} planned={planned} onClose={() => setDialog(null)} act={act} />}
    </section>
  );
}

const COLOURS = [['todo', 'Grey'], ['doing', 'Blue'], ['review', 'Amber']];

// The columns of the board: add, rename, recolour, reorder and remove them.
function ColumnsEditor({ columns, onChange, issues }) {
  const set = (n, change) => onChange(columns.map((c, i) => (i === n ? { ...c, ...change } : c)));
  const move = (n, by) => {
    const next = [...columns];
    [next[n], next[n + by]] = [next[n + by], next[n]];
    onChange(next);
  };
  const fixed = (c) => c.id === 'todo' || c.id === 'done';
  const count = (c) => (c.id ? issues.filter((i) => i.status === c.id).length : 0);
  return (
    <fieldset className="cols-edit">
      <legend>Board columns</legend>
      <small>The steps work goes through, from left to right. They apply to every sprint in this space.</small>
      {columns.map((c, n) => (
        <div className="cols-row" key={c.id || c.temp}>
          <span className={`cols-dot s-${c.cat}`} />
          <input value={c.name} maxLength={30} required placeholder="Column name" aria-label={`Name of column ${n + 1}`} autoFocus={!c.id && !c.name} onChange={(e) => set(n, { name: e.target.value })} />
          {fixed(c)
            ? <span className="cols-note">{c.id === 'todo' ? 'New issues start here' : 'Finished work'}</span>
            : <select value={c.cat} aria-label={`Colour of ${c.name || 'the column'}`} onChange={(e) => set(n, { cat: e.target.value })}>{COLOURS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
          <button type="button" className="icon-btn" disabled={n === 0} onClick={() => move(n, -1)} title="Move earlier" aria-label={`Move ${c.name} earlier`}><Icon name="up" /></button>
          <button type="button" className="icon-btn" disabled={n === columns.length - 1} onClick={() => move(n, 1)} title="Move later" aria-label={`Move ${c.name} later`}><Icon name="down" /></button>
          <button type="button" className="icon-btn" disabled={fixed(c)} onClick={() => onChange(columns.filter((_, i) => i !== n))}
            title={fixed(c) ? 'This column cannot be removed' : count(c) ? `Remove (its ${count(c)} ${count(c) === 1 ? 'issue goes' : 'issues go'} back to the first step)` : 'Remove'} aria-label={`Remove ${c.name}`}><Icon name="trash" /></button>
        </div>
      ))}
      {columns.length < 10 && (
        <button type="button" className="btn subtle cols-add" onClick={() => {
          const next = [...columns];
          const done = next.findIndex((c) => c.id === 'done');
          next.splice(done === next.length - 1 ? done : next.length, 0, { temp: Date.now(), name: '', cat: 'doing' }); // just before Done when Done is last
          onChange(next);
        }}><Icon name="plus" />Add column</button>
      )}
    </fieldset>
  );
}

// Creates a sprint, or edits one when `sprint` is given. Editing also covers the board's columns.
export function SprintDialog({ project, sprints, sprint, columns: current, issues = [], onClose, act }) {
  const last = sprints.reduce((a, s) => (!a || s.end > a.end ? s : a), null);
  const number = Math.max(0, ...sprints.map((s) => Number(s.name.match(/(\d+)\s*$/)?.[1] || 0))) + 1;
  const start = sprint ? sprint.start : last ? addDays(last.end, 1) : today();
  const [columns, setColumns] = useState(current || []);
  const submit = async (e) => {
    e.preventDefault();
    const input = { name: e.target.name.value, start: e.target.start.value, end: e.target.end.value, goal: e.target.goal.value };
    if (!sprint) {
      if (await act(M.createSprint, { space: project.key, input }, 'Sprint created.')) onClose();
      return;
    }
    const sent = columns.map(({ id, name, cat }) => ({ id, name, cat }));
    const columnsChanged = JSON.stringify(sent) !== JSON.stringify(current.map(({ id, name, cat }) => ({ id, name, cat })));
    const sprintChanged = ['name', 'start', 'end'].some((k) => input[k] !== sprint[k]) || input.goal !== (sprint.goal || '');
    if (columnsChanged && !await act(M.setColumns, { space: project.key, columns: sent }, sprintChanged ? null : 'Board columns updated.')) return;
    if (sprintChanged && !await act(M.updateSprint, { id: sprint.id, input }, columnsChanged ? 'Sprint and board columns updated.' : 'Sprint updated.')) return;
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <form className="dialog" onSubmit={submit}>
        <header><h2>{sprint ? `Edit ${sprint.name}` : 'Create sprint'}</h2><CloseButton onClose={onClose} /></header>
        <label>Sprint name <span className="req">*</span><input name="name" required autoComplete="off" autoFocus defaultValue={sprint ? sprint.name : `${project.key} Sprint ${number}`} /></label>
        <div className="grid2">
          <label>Start date <span className="req">*</span><input name="start" type="date" required defaultValue={start} /></label>
          <label>End date <span className="req">*</span><input name="end" type="date" required defaultValue={sprint ? sprint.end : addDays(start, 13)} /></label>
        </div>
        <label>Sprint goal<textarea name="goal" rows={2} defaultValue={sprint?.goal || ''} /></label>
        {sprint && current && <ColumnsEditor columns={columns} onChange={setColumns} issues={issues} />}
        <footer><button type="button" className="btn subtle" onClick={onClose}>Cancel</button><button className="btn primary">{sprint ? 'Save' : 'Create'}</button></footer>
      </form>
    </Modal>
  );
}

export function FinishSprint({ sprint, issues, planned, onClose, act }) {
  const list = issues.filter((i) => i.sprint === sprint.id);
  const done = list.filter((i) => i.status === 'done').length;
  const open = list.length - done;
  const submit = async (e) => {
    e.preventDefault();
    await act(M.completeSprint, { id: sprint.id, moveTo: e.target.moveTo?.value || null }, `${sprint.name} completed.`);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <form className="dialog" onSubmit={submit}>
        <header><h2>Complete {sprint.name}</h2><CloseButton onClose={onClose} /></header>
        <p>This sprint contains <b>{done} completed {done === 1 ? 'issue' : 'issues'}</b> and <b>{open} open {open === 1 ? 'issue' : 'issues'}</b>.</p>
        {open > 0 && (
          <label>Move open issues to
            <select name="moveTo" defaultValue={planned[0]?.id || ''}>
              {planned.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="">Backlog</option>
            </select>
          </label>
        )}
        <footer><button type="button" className="btn subtle" onClick={onClose}>Cancel</button><button className="btn primary">Complete sprint</button></footer>
      </form>
    </Modal>
  );
}
