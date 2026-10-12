import React, { useState } from 'react';
import { M } from './graphql.js';
import { Avatar, CloseButton, fields, firstName, Icon, Modal, PRIORITIES, status, statusClass, TYPE_NAMES, Time, TypeIcon } from '@scrumwise/ui';

// Every reply under a comment, at any depth, in reading order, paired with the comment it answers.
function descendants(comment, all) {
  return all.filter((c) => c.parent === comment.id).flatMap((r) => [[r, comment], ...descendants(r, all)]);
}

function Comment({ c, answers, depth, all, users, me, role, send, remove }) {
  const [mode, setMode] = useState(null); // 'reply' or 'delete'
  const below = descendants(c, all).length;
  const mine = c.by === me.id || role === 'Administrator';
  const reply = async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (text && await send(text, c.id)) setMode(null);
  };
  return (
    <div className="hist-item">
      <Avatar user={users[c.by] || { name: c.byName }} size={depth ? 'sm' : ''} />
      <div className="comment">
        <p><b>{c.byName}</b> <small><Time at={c.at} /></small></p>
        {answers && <p className="reply-to"><Icon name="arrow" />Replying to {answers.byName}</p>}
        <p className="comment-text">{c.text}</p>
        {mode === 'delete' ? (
          <div className="confirm">
            <span>Delete this comment{below ? ` and the ${below} ${below === 1 ? 'reply' : 'replies'} under it` : ''}?</span>
            <button className="btn danger" onClick={() => remove(c.id)}>Delete</button>
            <button className="btn" onClick={() => setMode(null)}>Cancel</button>
          </div>
        ) : mode === 'reply' ? (
          <form className="comment-form reply-form" onSubmit={reply}>
            <Avatar user={me} size="sm" />
            <div>
              <textarea name="text" rows={2} placeholder={`Reply to ${firstName({ name: c.byName })}…`} aria-label="Write a reply" required autoFocus />
              <span className="row-actions"><button className="btn primary">Save</button><button type="button" className="btn subtle" onClick={() => setMode(null)}>Cancel</button></span>
            </div>
          </form>
        ) : (
          <span className="comment-actions">
            <button className="link" onClick={() => setMode('reply')}>Reply</button>
            {mine && <button className="link" onClick={() => setMode('delete')}>Delete</button>}
          </span>
        )}
        {/* Replies of replies sit at the same indent as first replies, with a note saying who they answer. */}
        {depth === 0 && below > 0 && (
          <div className="replies">
            {descendants(c, all).map(([r, parent]) => <Comment key={r.id} c={r} answers={parent === c ? null : parent} depth={1} {...{ all, users, me, role, send, remove }} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export function IssueModal({ issue, data, users, me, act, role, canEdit, team, onClose }) {
  const [tab, setTab] = useState('comments');
  const [editing, setEditing] = useState(null); // 'title' or 'desc'
  const patch = (input) => act(M.updateIssue, { key: issue.key, input });
  const send = (text, parent) => act(M.addComment, { issue: issue.key, text, parent });
  const remove = (id) => act(M.deleteComment, { issue: issue.key, id }, 'Comment deleted.');
  const saveText = (field) => async (e) => {
    e.preventDefault();
    await patch({ [field]: e.target.text.value.trim() });
    setEditing(null);
  };
  const comment = async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.text.value.trim() && await send(form.text.value.trim(), null)) form.reset();
  };
  const top = issue.comments.filter((c) => !c.parent).reverse(); // newest first
  const sprints = data.sprints.filter((s) => s.state !== 'done' || s.id === issue.sprint);
  const edit = (field) => (canEdit ? { className: `editable ${field === 'desc' ? `desc ${issue.desc ? '' : 'placeholder'}` : ''}`, title: 'Click to edit', tabIndex: 0, onClick: () => setEditing(field) } : { className: field === 'desc' ? 'desc' : '' });

  return (
    <Modal wide onClose={onClose}>
      <div className="dialog tmodal">
        <header className="tmodal-head">
          <span className="crumbs">{data.project.name} <span>/</span> <TypeIcon type={issue.type} /><span className="tid">{issue.key}</span></span>
          <CloseButton onClose={onClose} />
        </header>

        <div className="tmodal-main">
          {editing === 'title' ? (
            <form className="edit-form" onSubmit={saveText('title')}>
              <input name="text" required defaultValue={issue.title} aria-label="Summary" autoFocus />
              <span className="row-actions"><button className="btn primary">Save</button><button type="button" className="btn subtle" onClick={() => setEditing(null)}>Cancel</button></span>
            </form>
          ) : <h2 {...edit('title')}>{issue.title}</h2>}

          <p className="label">Description</p>
          {editing === 'desc' ? (
            <form className="edit-form" onSubmit={saveText('desc')}>
              <textarea name="text" rows={5} defaultValue={issue.desc} placeholder="Add a description…" aria-label="Description" autoFocus />
              <span className="row-actions"><button className="btn primary">Save</button><button type="button" className="btn subtle" onClick={() => setEditing(null)}>Cancel</button></span>
            </form>
          ) : <p {...edit('desc')}>{issue.desc || (canEdit ? 'Add a description…' : 'No description.')}</p>}

          <p className="label">Activity</p>
          <div className="tabs"><span className="muted">Show:</span>
            <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>Comments</button>
            <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
          </div>

          {tab === 'comments' ? <>
            {role !== 'Viewer' && (
              <form className="comment-form" onSubmit={comment}>
                <Avatar user={me} />
                <div><textarea name="text" rows={2} placeholder="Add a comment…" aria-label="Add a comment" required /><button className="btn primary">Save</button></div>
              </form>
            )}
            <div className="hist">
              {top.map((c) => <Comment key={c.id} c={c} depth={0} all={issue.comments} {...{ users, me, role, send, remove }} />)}
              {!top.length && <p className="muted">There are no comments yet on this issue.</p>}
            </div>
          </> : (
            <div className="hist">
              {issue.history.map((h, n) => <div className="hist-item" key={n}><Avatar user={users[h.by] || { name: h.byName }} size="sm" /><p><b>{h.byName}</b> {h.text} <small><Time at={h.at} /></small></p></div>)}
            </div>
          )}
        </div>

        <aside className="tmodal-side">
          <select className={`status-select ${statusClass(status(issue.status, data.project.columns))}`} aria-label="Status" value={issue.status} disabled={!canEdit} onChange={(e) => patch({ status: e.target.value })}>
            {data.project.columns.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="details">
            <p className="details-title">Details</p>
            <label className="drow"><span>Assignee</span>
              <select value={issue.assignee || ''} disabled={!canEdit} onChange={(e) => patch({ assignee: e.target.value || null, assigneeName: users[e.target.value]?.name })}>
                <option value="">Unassigned</option>
                {team.map((id) => <option key={id} value={id}>{users[id]?.name || '…'}</option>)}
              </select>
            </label>
            <div className="drow"><span>Reporter</span><span className="who"><Avatar user={users[issue.reporter]} size="sm" />{users[issue.reporter]?.name}</span></div>
            <label className="drow"><span>Type</span>
              <select value={issue.type} disabled={!canEdit} onChange={(e) => patch({ type: e.target.value })}>{Object.entries(TYPE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="drow"><span>Priority</span>
              <select value={issue.priority} disabled={!canEdit} onChange={(e) => patch({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
            </label>
            <label className="drow"><span>Story points</span>
              <input type="number" min="0" max="100" placeholder="None" key={issue.points} defaultValue={issue.points ?? ''} disabled={!canEdit} onBlur={(e) => String(issue.points ?? '') !== e.target.value && patch({ points: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label className="drow"><span>Sprint</span>
              <select value={issue.sprint || ''} disabled={!canEdit} onChange={(e) => patch({ sprint: e.target.value || null })}>
                <option value="">None (Backlog)</option>
                {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="drow"><span>Labels</span>
              <input placeholder="None" key={issue.labels.join()} defaultValue={issue.labels.join(', ')} disabled={!canEdit} onBlur={(e) => issue.labels.join(', ') !== e.target.value && patch({ labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) })} />
            </label>
          </div>
          <p className="muted small">Created <Time at={issue.createdAt} /> · Updated <Time at={issue.updatedAt} /></p>
          {canEdit && <button className="btn subtle start" onClick={async () => { if (window.confirm(`Delete ${issue.key}? This cannot be undone.`)) { await act(M.deleteIssue, { key: issue.key }, `${issue.key} deleted.`); onClose(); } }}>Delete issue</button>}
        </aside>
      </div>
    </Modal>
  );
}

export function CreateIssue({ data, users, act, team, onClose }) {
  const submit = async (e) => {
    e.preventDefault();
    const f = fields(e.target);
    const input = { type: f.type, title: f.title, desc: f.desc, priority: f.priority, assignee: f.assignee || null, sprint: f.sprint || null, points: f.points === '' ? null : Number(f.points) };
    const created = await act(M.createIssue, { space: data.project.key, input }, 'Issue created.');
    if (created) { onClose(); }
  };
  return (
    <Modal onClose={onClose}>
      <form className="dialog" onSubmit={submit}>
        <header><h2>Create issue</h2><CloseButton onClose={onClose} /></header>
        <div className="grid2">
          <label>Space<input value={`${data.project.name} (${data.project.key})`} disabled readOnly /></label>
          <label>Issue type<select name="type" defaultValue="task">{Object.entries(TYPE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <label>Summary <span className="req">*</span><input name="title" required autoComplete="off" autoFocus /></label>
        <label>Description<textarea name="desc" rows={4} /></label>
        <div className="grid2">
          <label>Assignee<select name="assignee"><option value="">Unassigned</option>{team.map((id) => <option key={id} value={id}>{users[id]?.name}</option>)}</select></label>
          <label>Priority<select name="priority" defaultValue="Medium">{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Sprint<select name="sprint"><option value="">None (Backlog)</option>{data.sprints.filter((s) => s.state !== 'done').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Story points<input name="points" type="number" min="0" max="100" /></label>
        </div>
        <footer><button type="button" className="btn subtle" onClick={onClose}>Cancel</button><button className="btn primary">Create</button></footer>
      </form>
    </Modal>
  );
}
