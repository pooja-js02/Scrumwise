import React, { useEffect, useState } from 'react';
import { Avatar, daysUntil, Icon, PriIcon, TypeIcon } from '@scrumwise/ui';
import { M } from './graphql.js';
import { FilterBar, FinishSprint, SprintDialog, useFilters } from './Backlog.jsx';
import { SprintDetails, SprintInsights, StandUp, useBoardView, ViewSettings } from './Sprint.jsx';

export function Board({ data, users, me, act, open, canEdit }) {
  const { project, sprints, issues } = data;
  const filters = useFilters(me);
  const [over, setOver] = useState(null);
  const [dialog, setDialog] = useState(null); // 'complete' | 'details' | 'insights' | 'edit'
  const [pop, setPop] = useState(null); // 'view' | 'more'
  const [standUp, setStandUp] = useState(null); // whose turn it is, or null
  const [view, setView] = useBoardView();
  const sprint = sprints.find((s) => s.state === 'active');
  const columns = project.columns;
  useEffect(() => {
    if (!pop) return undefined;
    const close = () => setPop(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [pop]);

  if (!sprint) {
    return (
      <section className="page">
        <div className="empty">
          <p><b>There is no active sprint.</b><br />Plan a sprint in the backlog, then start it to see its issues here.</p>
          <a className="btn primary" href={`#/p/${project.key}/backlog`}>Go to Backlog</a>
        </div>
      </section>
    );
  }

  const inSprint = issues.filter((i) => i.sprint === sprint.id);
  const left = daysUntil(sprint.end);
  // Everyone with work in the sprint takes a turn; unassigned work comes last.
  const speakers = [...new Set(inSprint.map((i) => i.assignee || ''))].sort((a, b) => !a - !b || (users[a]?.name || '').localeCompare(users[b]?.name || ''));
  const turn = standUp == null ? null : speakers[Math.min(standUp, speakers.length - 1)];
  const toggle = (name) => (e) => { e.stopPropagation(); setPop(pop === name ? null : name); };
  const drop = (e, column) => {
    e.preventDefault();
    setOver(null);
    const issue = issues.find((i) => i.key === e.dataTransfer.getData('text/plain'));
    if (issue && issue.status !== column) act(M.updateIssue, { key: issue.key, input: { status: column } }, `${issue.key} moved to ${columns.find((s) => s.id === column).name}.`);
  };

  return (
    <section className="page wide">
      <header className="page-head">
        <div><h1 className="keep">{sprint.name}</h1>{sprint.goal && <p className="muted">{sprint.goal}</p>}</div>
        <div className="board-actions">
          <span className="muted">{left < 0 ? 'Sprint has ended' : `${left} ${left === 1 ? 'day' : 'days'} remaining`}</span>
          {canEdit && <button className="btn primary" onClick={() => setDialog('complete')}>Complete sprint</button>}
          <button className="icon-btn" onClick={() => setDialog('details')} title="Sprint details" aria-label="Sprint details"><Icon name="info" /></button>
          <button className="icon-btn" onClick={() => setDialog('insights')} title="Sprint insights" aria-label="Sprint insights"><Icon name="chart" /></button>
          <span className="pop-wrap">
            <button className={`icon-btn ${pop === 'view' ? 'on' : ''}`} onClick={toggle('view')} title="View settings" aria-label="View settings" aria-expanded={pop === 'view'}><Icon name="sliders" /></button>
            {pop === 'view' && <ViewSettings view={view} onChange={setView} />}
          </span>
          <span className="pop-wrap">
            <button className={`icon-btn ${pop === 'more' ? 'on' : ''}`} onClick={toggle('more')} title="More actions" aria-label="More actions" aria-expanded={pop === 'more'}><Icon name="dots" /></button>
            {pop === 'more' && (
              <div className="tool-pop tool-menu" role="menu">
                {canEdit && <button role="menuitem" onClick={() => setDialog('edit')}><Icon name="edit" />Edit sprint</button>}
                <button role="menuitem" disabled={!speakers.length} onClick={() => setStandUp(0)}><Icon name="users" />{standUp == null ? 'Start stand-up' : 'Restart stand-up'}</button>
              </div>
            )}
          </span>
        </div>
      </header>
      {standUp != null && speakers.length > 0 && (
        <StandUp people={speakers} users={users} index={Math.min(standUp, speakers.length - 1)} issues={inSprint} columns={columns} onStep={setStandUp} onEnd={() => setStandUp(null)} />
      )}
      <FilterBar filters={filters} users={users} people={[...new Set(inSprint.map((i) => i.assignee).filter(Boolean))]} placeholder="Search board" />
      <div className={`board ${view.compact ? 'compact' : ''}`}>
        {columns.map((column) => {
          const items = inSprint.filter((i) => i.status === column.id && filters.match(i) && (turn == null || (i.assignee || '') === turn));
          return (
            <div key={column.id} className={`col s-${column.cat} ${over === column.id ? 'over' : ''}`}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(column.id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, column.id)}>
              <div className="col-head">{column.name} <span>{items.length}</span>{column.id === 'done' && <Icon name="check" />}</div>
              <div className="col-body">
                {items.map((i) => (
                  <article key={i.key} className="tcard" tabIndex={0} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData('text/plain', i.key)}
                    onClick={() => open(i.key)} onKeyDown={(e) => e.key === 'Enter' && open(i.key)}>
                    <p className="tcard-title">{i.title}</p>
                    <div className="tcard-foot">
                      {view.type && <TypeIcon type={i.type} />}{view.key && <span className={`tid ${i.status === 'done' ? 'struck' : ''}`}>{i.key}</span>}<span className="spacer" />
                      {view.points && i.points != null && <span className="pts" title="Story points">{i.points}</span>}{view.priority && <PriIcon value={i.priority} />}{view.assignee && <Avatar user={users[i.assignee]} size="sm" />}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {dialog === 'complete' && <FinishSprint sprint={sprint} issues={issues} planned={sprints.filter((s) => s.state === 'planned')} onClose={() => setDialog(null)} act={act} />}
      {dialog === 'details' && <SprintDetails sprint={sprint} issues={issues} columns={columns} canEdit={canEdit} onEdit={() => setDialog('edit')} onClose={() => setDialog(null)} />}
      {dialog === 'insights' && <SprintInsights sprint={sprint} issues={issues} columns={columns} users={users} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <SprintDialog project={project} sprints={sprints} sprint={sprint} columns={columns} issues={issues} onClose={() => setDialog(null)} act={act} />}
    </section>
  );
}
