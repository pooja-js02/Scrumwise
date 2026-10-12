import React, { useEffect, useMemo, useState } from 'react';
import { addDays, Avatar, CloseButton, dateOf, day, daysUntil, Icon, Loz, Modal, STATUSES, today, phase } from '@scrumwise/ui';

// ---------- numbers every sprint view needs ----------
export function sprintFacts(sprint, issues, columns = STATUSES) {
  const list = issues.filter((i) => i.sprint === sprint.id);
  const usePoints = list.some((i) => i.points != null);
  const size = (i) => (usePoints ? i.points || 0 : 1);
  const sum = (items) => items.reduce((n, i) => n + size(i), 0);
  const done = list.filter((i) => i.status === 'done');
  const length = Math.max(1, daysUntil(sprint.end) - daysUntil(sprint.start) + 1);
  return {
    list, done, size, sum, length, usePoints,
    unit: usePoints ? 'points' : 'issues',
    total: sum(list), finished: sum(done),
    left: daysUntil(sprint.end),
    byStatus: columns.map((s) => ({ ...s, items: list.filter((i) => i.status === s.id) })),
  };
}
const daysLeft = (left) => (left < 0 ? 'Sprint has ended' : left === 0 ? 'Last day' : `${left} ${left === 1 ? 'day' : 'days'} remaining`);

// The day an issue was finished, on the viewer's calendar. The newest history entry comes first.
const finishedOn = (issue) => dateOf(issue.history.find((h) => h.text === 'changed the status to Done')?.at || issue.updatedAt);

// ---------- sprint details ----------
export function SprintDetails({ sprint, issues, columns, canEdit, onEdit, onClose }) {
  const f = sprintFacts(sprint, issues, columns);
  return (
    <Modal onClose={onClose}>
      <div className="dialog">
        <header><h2>{sprint.name}</h2><CloseButton onClose={onClose} /></header>
        <dl className="facts">
          <dt>Dates</dt><dd>{day(sprint.start)} – {day(sprint.end)} <span className="muted">· {f.length} days</span></dd>
          <dt>Time left</dt><dd>{daysLeft(f.left)}</dd>
          <dt>Goal</dt><dd>{sprint.goal || <span className="muted">No goal set</span>}</dd>
          <dt>Issues</dt><dd>{f.done.length} of {f.list.length} done</dd>
          {f.usePoints && <><dt>Story points</dt><dd>{f.finished} of {f.total} done</dd></>}
          <dt>By status</dt>
          <dd className="status-counts">{f.byStatus.map((s) => <span key={s.id}><Loz value={s.id} columns={columns} /> {s.items.length}</span>)}</dd>
        </dl>
        <footer>
          {canEdit && <button className="btn subtle" onClick={onEdit}><Icon name="edit" />Edit sprint</button>}
          <button className="btn primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </Modal>
  );
}

// ---------- sprint insights ----------
const W = 900, H = 240, PAD = { l: 38, r: 64, t: 14, b: 28 };

function Burndown({ sprint, facts }) {
  const [at, setAt] = useState(null);
  const { total, length, unit } = facts;
  // Step 0 is the start of the sprint; step n is the end of its n-th day.
  const rows = useMemo(() => {
    const finished = facts.done.map((i) => ({ on: finishedOn(i), size: facts.size(i) }));
    const now = today();
    return Array.from({ length: length + 1 }, (_, n) => {
      const date = n ? addDays(sprint.start, n - 1) : null;
      const past = !date || date <= now;
      // Work finished before the sprint began counts from the first day.
      const burned = date ? finished.filter((x) => x.on <= date).reduce((s, x) => s + x.size, 0) : 0;
      return { n, label: date ? day(date) : 'Start', ideal: Math.round((total - (total * n) / length) * 10) / 10, actual: past ? total - burned : null };
    });
  }, [facts, sprint, total, length]);

  const top = Math.max(1, total);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => top / s <= 5) || 1000;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, k) => k * step);
  const x = (n) => PAD.l + ((W - PAD.l - PAD.r) * n) / length;
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top);
  const drawn = rows.filter((r) => r.actual != null);
  const last = drawn[drawn.length - 1];
  const every = Math.ceil((length + 1) / 8);
  const hover = at == null ? null : rows[at];
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const n = Math.round((((e.clientX - box.left) / box.width) * W - PAD.l) / ((W - PAD.l - PAD.r) / length));
    setAt(Math.max(0, Math.min(length, n)));
  };

  return (
    <figure className="chart">
      <figcaption>
        <b>Burndown</b>
        <span className="legend"><i className="key actual" />Remaining<i className="key ideal" />Guideline</span>
      </figcaption>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burndown: ${last.actual} of ${total} ${unit} remaining`} onMouseMove={move} onMouseLeave={() => setAt(null)}>
          {ticks.map((t) => (
            <g key={t}><line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} /><text className="tick" x={PAD.l - 8} y={y(t) + 4} textAnchor="end">{t}</text></g>
          ))}
          {rows.filter((r) => r.n % every === 0).map((r) => <text key={r.n} className="tick" x={x(r.n)} y={H - 8} textAnchor="middle">{r.label}</text>)}
          <polyline className="line ideal" points={rows.map((r) => `${x(r.n)},${y(r.ideal)}`).join(' ')} />
          <polyline className="line actual" points={drawn.map((r) => `${x(r.n)},${y(r.actual)}`).join(' ')} />
          {hover && <line className="cross" x1={x(hover.n)} x2={x(hover.n)} y1={PAD.t} y2={H - PAD.b} />}
          {hover?.actual != null && hover !== last && <circle className="dot" cx={x(hover.n)} cy={y(hover.actual)} r="4" />}
          <circle className="dot" cx={x(last.n)} cy={y(last.actual)} r="4.5" />
          <text className="end-label" x={x(last.n) + 10} y={y(last.actual) + 4}>{last.actual} left</text>
        </svg>
        {hover && (
          <div className={`chart-tip ${hover.n > length / 2 ? 'flip' : ''}`} style={{ left: `${(x(hover.n) / W) * 100}%` }}>
            <b>{hover.n ? `End of ${hover.label}` : 'Sprint start'}</b>
            <span><i className="key actual" />Remaining <b>{hover.actual ?? '—'}</b></span>
            <span><i className="key ideal" />Guideline <b>{hover.ideal}</b></span>
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Show as a table</summary>
        <table className="table">
          <thead><tr><th>Day</th><th>Remaining {unit}</th><th>Guideline</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.n}><td>{r.label}</td><td>{r.actual ?? '—'}</td><td>{r.ideal}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

export function SprintInsights({ sprint, issues, columns, users, onClose }) {
  const f = sprintFacts(sprint, issues, columns);
  const underWay = f.byStatus.filter((s) => phase(s) === 'doing').reduce((n, s) => n + s.items.length, 0);
  const percent = f.total ? Math.round((f.finished / f.total) * 100) : 0;
  const people = [...new Set(f.list.map((i) => i.assignee || ''))].map((id) => {
    const mine = f.list.filter((i) => (i.assignee || '') === id);
    return { id, user: users[id], issues: mine.length, total: f.sum(mine), done: f.sum(mine.filter((i) => i.status === 'done')) };
  }).sort((a, b) => b.total - a.total);
  return (
    <Modal onClose={onClose} wide>
      <div className="dialog insights">
        <header><h2>{sprint.name} insights</h2><CloseButton onClose={onClose} /></header>
        <div className="kpis">
          <div><small>Completed</small><b>{percent}%</b><span>{f.finished} of {f.total} {f.unit}</span></div>
          <div><small>Remaining</small><b>{f.total - f.finished}</b><span>{f.unit} still open</span></div>
          <div><small>Time left</small><b>{Math.max(0, f.left)}</b><span>{f.left < 0 ? 'the sprint has ended' : `of ${f.length} days`}</span></div>
          <div><small>In progress</small><b>{underWay}</b><span>{underWay === 1 ? 'issue' : 'issues'} being worked on</span></div>
        </div>
        {f.list.length ? <Burndown sprint={sprint} facts={f} /> : <p className="muted">This sprint has no issues yet.</p>}
        {people.length > 0 && (
          <div>
            <h3 className="label">Workload</h3>
            {people.map((p) => (
              <div key={p.id} className="load-row">
                <Avatar user={p.user} size="sm" />
                <span className="load-name clip">{p.user?.name || 'Unassigned'}</span>
                <span className="meter" title={`${p.done} of ${p.total} ${f.unit} done`}><i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
                <span className="load-num">{p.done} / {p.total} {f.unit}</span>
                <span className="muted load-num">{p.issues} {p.issues === 1 ? 'issue' : 'issues'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- view settings: what a card shows, remembered in this browser ----------
const VIEW = { key: true, type: true, priority: true, points: true, assignee: true, compact: false };
const VIEW_LABELS = { key: 'Issue key', type: 'Issue type', priority: 'Priority', points: 'Story points', assignee: 'Assignee' };
export function useBoardView() {
  const [view, setView] = useState(() => {
    try { return { ...VIEW, ...JSON.parse(localStorage.getItem('scrumwise.board-view') || '{}') }; } catch { return VIEW; }
  });
  const change = (next) => {
    setView(next);
    try { localStorage.setItem('scrumwise.board-view', JSON.stringify(next)); } catch { /* the choice lasts for this visit only */ }
  };
  return [view, change];
}
export function ViewSettings({ view, onChange }) {
  const box = (name, label) => (
    <label key={name} className="check"><input type="checkbox" checked={view[name]} onChange={(e) => onChange({ ...view, [name]: e.target.checked })} />{label}</label>
  );
  return (
    <div className="tool-pop view-pop" role="dialog" aria-label="View settings" onClick={(e) => e.stopPropagation()}>
      <b>View settings</b>
      <small>Show on cards</small>
      {Object.entries(VIEW_LABELS).map(([name, label]) => box(name, label))}
      <hr />
      {box('compact', 'Compact cards')}
      <button className="link" onClick={() => onChange(VIEW)}>Reset to default</button>
    </div>
  );
}

// ---------- stand-up: walk the board one person at a time ----------
export function StandUp({ people, users, index, issues, columns, onStep, onEnd }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const id = people[index];
  const mine = issues.filter((i) => (i.assignee || '') === id);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="standup" role="region" aria-label="Stand-up">
      <Avatar user={users[id]} />
      <div className="grow">
        <b>{users[id]?.name || 'Unassigned'}</b>
        <small>{columns.map((s) => `${mine.filter((i) => i.status === s.id).length} ${s.name.toLowerCase()}`).join(' · ')}</small>
      </div>
      <span className="muted">{index + 1} of {people.length}</span>
      <span className="time" title="Time since the stand-up started">{clock}</span>
      <button className="btn" disabled={index === 0} onClick={() => onStep(index - 1)}>Previous</button>
      {index < people.length - 1
        ? <button className="btn primary" onClick={() => onStep(index + 1)}>Next</button>
        : <button className="btn primary" onClick={onEnd}>Finish</button>}
      <button className="icon-btn" onClick={onEnd} title="End stand-up" aria-label="End stand-up"><Icon name="x" /></button>
    </div>
  );
}
