// Project service: spaces (projects), their members, sprints, issues and comments.
import { HttpError, mongoose, requireUser, startService, wrap } from '@scrumwise/common';

const { Schema } = mongoose;
// The board columns a space starts with. A space can add its own; "todo" and "done" always stay,
// because new issues start in one and finished work is counted from the other.
const DEFAULT_COLUMNS = [
  { id: 'todo', name: 'To Do', cat: 'todo' }, { id: 'doing', name: 'In Progress', cat: 'doing' },
  { id: 'review', name: 'In Review', cat: 'review' }, { id: 'done', name: 'Done', cat: 'done' },
];
const CATS = ['todo', 'doing', 'review'];
const columnsOf = (project) => (project.columns?.length ? project.columns.map((c) => ({ id: c.id, name: c.name, cat: c.cat })) : DEFAULT_COLUMNS);
const columnOf = (project, id) => columnsOf(project).find((c) => c.id === id);
const ROLES = ['Administrator', 'Member', 'Viewer', 'Client'];

const Project = mongoose.model('Project', new Schema({
  key: { type: String, required: true, unique: true, uppercase: true, match: /^[A-Z]{2,5}$/ },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  lead: String,
  hue: { type: Number, default: () => Math.floor(Math.random() * 360) },
  members: [{ _id: false, user: String, role: { type: String, enum: ROLES, default: 'Member' } }],
  nextNumber: { type: Number, default: 1 },
  columns: { type: [{ _id: false, id: String, name: String, cat: String }], default: undefined },
}, { timestamps: true }));

const Sprint = mongoose.model('Sprint', new Schema({
  project: { type: String, index: true },
  name: { type: String, required: true, trim: true },
  goal: { type: String, default: '' },
  start: String, // YYYY-MM-DD
  end: String,
  state: { type: String, enum: ['planned', 'active', 'done'], default: 'planned' },
}, { timestamps: true }));

const Issue = mongoose.model('Issue', new Schema({
  project: { type: String, index: true },
  key: { type: String, unique: true },
  type: { type: String, enum: ['story', 'bug', 'task'], default: 'task' },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  desc: { type: String, default: '' },
  status: { type: String, default: 'todo' }, // the id of one of the space's columns
  priority: { type: String, enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'], default: 'Medium' },
  points: { type: Number, default: null, min: 0 },
  assignee: { type: String, default: null },
  reporter: String,
  sprint: { type: Schema.Types.ObjectId, default: null },
  labels: [String],
  // A comment with a parent is a reply. Deleting a comment deletes every reply under it.
  comments: [{ by: String, byName: String, text: String, at: { type: Date, default: Date.now }, parent: { type: Schema.Types.ObjectId, default: null } }],
  history: [{ _id: false, by: String, byName: String, text: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true }));

const viewProject = (p) => ({ key: p.key, name: p.name, lead: p.lead, hue: p.hue, members: p.members, columns: columnsOf(p) });
const viewSprint = (s) => ({ id: s.id, project: s.project, name: s.name, goal: s.goal, start: s.start, end: s.end, state: s.state });
const viewIssue = (i) => ({
  key: i.key, project: i.project, type: i.type, title: i.title, desc: i.desc, status: i.status, priority: i.priority, points: i.points,
  assignee: i.assignee, reporter: i.reporter, sprint: i.sprint ? String(i.sprint) : null, labels: i.labels,
  comments: i.comments.map((c) => ({ id: c.id, by: c.by, byName: c.byName, text: c.text, at: c.at, parent: c.parent ? String(c.parent) : null })),
  history: i.history, createdAt: i.createdAt, updatedAt: i.updatedAt,
});

// Loads a project and checks the caller belongs to it. `roles` limits who may do the action.
async function projectFor(req, key, roles) {
  const project = await Project.findOne({ key: String(key).toUpperCase() });
  const me = project?.members.find((m) => m.user === req.user.id);
  if (!me) throw new HttpError(404, 'This space does not exist, or you are not a member of it.');
  if (roles && !roles.includes(me.role)) throw new HttpError(403, `Only ${roles.join(' or ').toLowerCase()}s can do this.`);
  return project;
}
const EDITORS = ['Administrator', 'Member'];
async function issueFor(req, key, roles) {
  const issue = await Issue.findOne({ key: String(key).toUpperCase() });
  if (!issue) throw new HttpError(404, 'This issue does not exist.');
  const project = await projectFor(req, issue.project, roles);
  return { issue, project };
}

await startService({
  name: 'project-service',
  routes(app, bus) {
    app.use(requireUser);
    // Events carry everything other services need, so nobody has to call back for details.
    const announce = (subject, req, project, issue, extra = {}) => bus.publish(subject, {
      project: project.key, projectName: project.name, members: project.members.map((m) => m.user),
      by: req.user.id, byName: req.user.name, ...(issue ? { key: issue.key, title: issue.title, assignee: issue.assignee, reporter: issue.reporter } : {}), ...extra,
    });

    // ----- spaces -----
    app.get('/projects', wrap(async (req, res) => {
      const projects = await Project.find({ 'members.user': req.user.id }).sort('name');
      const counts = await Issue.aggregate([{ $match: { project: { $in: projects.map((p) => p.key) } } }, { $group: { _id: '$project', n: { $sum: 1 } } }]);
      res.json(projects.map((p) => ({ ...viewProject(p), issues: counts.find((c) => c._id === p.key)?.n || 0 })));
    }));

    app.post('/projects', wrap(async (req, res) => {
      const key = String(req.body.key || '').trim().toUpperCase();
      const name = String(req.body.name || '').trim();
      if (!name) throw new HttpError(400, 'Give the space a name.');
      if (!/^[A-Z]{2,5}$/.test(key)) throw new HttpError(400, 'The key must be 2 to 5 letters.');
      if (await Project.exists({ key })) throw new HttpError(409, `The key ${key} is already used by another space.`);
      const project = await Project.create({ key, name, lead: req.user.id, members: [{ user: req.user.id, role: 'Administrator' }] });
      announce('project.created', req, project);
      res.status(201).json(viewProject(project));
    }));

    // Everything a project page needs, in one call.
    app.get('/projects/:key', wrap(async (req, res) => {
      const project = await projectFor(req, req.params.key);
      const [sprints, issues] = await Promise.all([Sprint.find({ project: project.key }).sort('start'), Issue.find({ project: project.key }).sort('createdAt')]);
      res.json({ project: viewProject(project), sprints: sprints.map(viewSprint), issues: issues.map(viewIssue) });
    }));

    app.post('/projects/:key/members', wrap(async (req, res) => {
      const project = await projectFor(req, req.params.key, ['Administrator']);
      const { userId, role = 'Member' } = req.body;
      if (!userId) throw new HttpError(400, 'Choose a person to add.');
      if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a valid role.');
      if (project.members.some((m) => m.user === userId)) throw new HttpError(409, 'This person is already in the space.');
      project.members.push({ user: userId, role });
      await project.save();
      announce('project.member_added', req, project, null, { userId, role });
      res.status(201).json(viewProject(project));
    }));

    app.patch('/projects/:key/members/:userId', wrap(async (req, res) => {
      const project = await projectFor(req, req.params.key, ['Administrator']);
      const member = project.members.find((m) => m.user === req.params.userId);
      if (!member) throw new HttpError(404, 'This person is not in the space.');
      if (!ROLES.includes(req.body.role)) throw new HttpError(400, 'Choose a valid role.');
      if (member.user === req.user.id) throw new HttpError(400, 'You cannot change your own role.');
      member.role = req.body.role;
      await project.save();
      res.json(viewProject(project));
    }));

    app.delete('/projects/:key/members/:userId', wrap(async (req, res) => {
      const project = await projectFor(req, req.params.key, ['Administrator']);
      if (req.params.userId === req.user.id) throw new HttpError(400, 'You cannot remove yourself.');
      project.members = project.members.filter((m) => m.user !== req.params.userId);
      await project.save();
      await Issue.updateMany({ project: project.key, assignee: req.params.userId }, { assignee: null });
      announce('project.member_removed', req, project, null, { userId: req.params.userId });
      res.json(viewProject(project));
    }));

    // The board's columns, in the order work moves through them. Send the whole list each time.
    app.put('/projects/:key/columns', wrap(async (req, res) => {
      const project = await projectFor(req, req.params.key, EDITORS);
      const before = columnsOf(project);
      const sent = Array.isArray(req.body.columns) ? req.body.columns : [];
      const columns = sent.map((c) => {
        const old = before.find((o) => o.id === c.id);
        const name = String(c.name || '').trim().slice(0, 30);
        if (!name) throw new HttpError(400, 'Every column needs a name.');
        const id = old ? old.id : `c${new mongoose.Types.ObjectId()}`;
        return { id, name, cat: id === 'todo' || id === 'done' ? id : CATS.includes(c.cat) ? c.cat : 'doing' };
      });
      if (new Set(columns.map((c) => c.id)).size !== columns.length) throw new HttpError(400, 'A column is listed twice.');
      if (new Set(columns.map((c) => c.name.toLowerCase())).size !== columns.length) throw new HttpError(400, 'Two columns cannot have the same name.');
      if (!columns.some((c) => c.id === 'todo') || !columns.some((c) => c.id === 'done')) throw new HttpError(400, 'The first column for new work and the Done column cannot be removed.');
      if (columns.length > 10) throw new HttpError(400, 'A board can have up to 10 columns.');
      // Issues in a removed column go back to the start of the workflow.
      const removed = before.filter((o) => !columns.some((c) => c.id === o.id));
      for (const gone of removed) {
        await Issue.updateMany({ project: project.key, status: gone.id }, {
          $set: { status: 'todo' },
          $push: { history: { $each: [{ by: req.user.id, byName: req.user.name, text: `removed the column ${gone.name}; the issue went back to ${columns.find((c) => c.id === 'todo').name}`, at: new Date() }], $position: 0 } },
        });
      }
      project.columns = columns;
      await project.save();
      announce('sprint.changed', req, project); // everyone looking at the space reloads it
      res.json(viewProject(project));
    }));

    // ----- issues -----
    app.get('/issues/mine', wrap(async (req, res) => {
      const projects = await Project.find({ 'members.user': req.user.id });
      const issues = await Issue.find({ project: { $in: projects.map((p) => p.key) }, assignee: req.user.id, status: { $ne: 'done' } }).sort('-updatedAt');
      res.json(issues.map((i) => {
        const project = projects.find((p) => p.key === i.project);
        const column = columnOf(project, i.status) || columnsOf(project)[0];
        return { ...viewIssue(i), projectName: project.name, statusName: column.name, statusCat: column.cat };
      }));
    }));

    app.post('/projects/:key/issues', wrap(async (req, res) => {
      const space = await projectFor(req, req.params.key, EDITORS);
      const b = req.body;
      if (!String(b.title || '').trim()) throw new HttpError(400, 'Give the issue a summary.');
      if (b.status && !columnOf(space, b.status)) throw new HttpError(400, 'This space has no such column.');
      // Take the next number atomically, so two people creating at once never get the same key.
      const project = await Project.findOneAndUpdate({ key: req.params.key.toUpperCase() }, { $inc: { nextNumber: 1 } });
      const issue = await Issue.create({
        project: project.key, key: `${project.key}-${project.nextNumber}`, type: b.type, title: b.title, desc: b.desc, status: b.status, priority: b.priority,
        points: b.points === '' || b.points == null ? null : Number(b.points), assignee: b.assignee || null, sprint: b.sprint || null, labels: b.labels || [], reporter: req.user.id,
        history: [{ by: req.user.id, byName: req.user.name, text: 'created the issue' }],
      });
      announce('issue.created', req, project, issue);
      if (issue.assignee && issue.assignee !== req.user.id) announce('issue.assigned', req, project, issue);
      res.status(201).json(viewIssue(issue));
    }));

    app.get('/issues/:key', wrap(async (req, res) => {
      res.json(viewIssue((await issueFor(req, req.params.key)).issue));
    }));

    app.patch('/issues/:key', wrap(async (req, res) => {
      const { issue, project } = await issueFor(req, req.params.key, EDITORS);
      const b = req.body;
      const note = (text) => issue.history.unshift({ by: req.user.id, byName: req.user.name, text });
      const before = { status: issue.status, assignee: issue.assignee };
      if ('title' in b && String(b.title).trim() && b.title !== issue.title) { issue.title = b.title; note('updated the summary'); }
      if ('desc' in b && b.desc !== issue.desc) { issue.desc = b.desc; note('updated the description'); }
      if ('type' in b && b.type !== issue.type) { issue.type = b.type; note(`changed the type to ${b.type}`); }
      if ('status' in b && b.status !== issue.status) {
        const column = columnOf(project, b.status);
        if (!column) throw new HttpError(400, 'This space has no such column.');
        // Finished work is always recorded as "Done", whatever the column is called, so reports can find it.
        issue.status = b.status; note(`changed the status to ${column.id === 'done' ? 'Done' : column.name}`);
      }
      if ('priority' in b && b.priority !== issue.priority) { issue.priority = b.priority; note(`changed the priority to ${b.priority}`); }
      if ('points' in b) { const p = b.points === '' || b.points == null ? null : Number(b.points); if (p !== issue.points) { issue.points = p; note(`changed the story points to ${p ?? 'none'}`); } }
      if ('assignee' in b && (b.assignee || null) !== issue.assignee) {
        if (b.assignee && !project.members.some((m) => m.user === b.assignee)) throw new HttpError(400, 'That person is not in this space.');
        issue.assignee = b.assignee || null; note(b.assigneeName ? `assigned the issue to ${b.assigneeName}` : issue.assignee ? 'changed the assignee' : 'removed the assignee');
      }
      if ('sprint' in b && String(b.sprint || '') !== String(issue.sprint || '')) {
        const sprint = b.sprint ? await Sprint.findOne({ _id: b.sprint, project: project.key }) : null;
        if (b.sprint && !sprint) throw new HttpError(400, 'That sprint does not exist.');
        issue.sprint = sprint?._id || null; note(`moved the issue to ${sprint ? sprint.name : 'the backlog'}`);
      }
      if ('labels' in b && Array.isArray(b.labels)) { issue.labels = b.labels.map((l) => String(l).trim()).filter(Boolean); note('changed the labels'); }
      await issue.save();
      announce('issue.updated', req, project, issue);
      if (issue.status !== before.status) announce('issue.status_changed', req, project, issue, { status: issue.status, statusName: columnOf(project, issue.status)?.name });
      if (issue.assignee && issue.assignee !== before.assignee && issue.assignee !== req.user.id) announce('issue.assigned', req, project, issue);
      res.json(viewIssue(issue));
    }));

    app.delete('/issues/:key', wrap(async (req, res) => {
      const { issue, project } = await issueFor(req, req.params.key, EDITORS);
      await issue.deleteOne();
      announce('issue.updated', req, project, issue);
      res.status(204).end();
    }));

    app.post('/issues/:key/comments', wrap(async (req, res) => {
      const { issue, project } = await issueFor(req, req.params.key, [...EDITORS, 'Client']);
      const text = String(req.body.text || '').trim();
      if (!text) throw new HttpError(400, 'Write something first.');
      if (req.body.parent && !issue.comments.id(req.body.parent)) throw new HttpError(400, 'The comment you are replying to no longer exists.');
      issue.comments.push({ by: req.user.id, byName: req.user.name, text, parent: req.body.parent || null });
      await issue.save();
      announce('issue.commented', req, project, issue, { text });
      res.status(201).json(viewIssue(issue));
    }));

    app.delete('/issues/:key/comments/:id', wrap(async (req, res) => {
      const { issue, project } = await issueFor(req, req.params.key);
      const target = issue.comments.id(req.params.id);
      if (!target) throw new HttpError(404, 'This comment no longer exists.');
      const admin = project.members.find((m) => m.user === req.user.id).role === 'Administrator';
      if (target.by !== req.user.id && !admin) throw new HttpError(403, 'You can only delete your own comments.');
      // Collect the comment and every reply below it, at any depth.
      const doomed = new Set([target.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const c of issue.comments) if (c.parent && doomed.has(String(c.parent)) && !doomed.has(c.id)) { doomed.add(c.id); grew = true; }
      }
      issue.comments = issue.comments.filter((c) => !doomed.has(c.id));
      await issue.save();
      announce('issue.updated', req, project, issue);
      res.json(viewIssue(issue));
    }));

    // ----- sprints -----
    app.post('/projects/:key/sprints', wrap(async (req, res) => {
      const project = await projectFor(req, req.params.key, EDITORS);
      const { name = '', goal = '', start, end } = req.body;
      if (!name.trim()) throw new HttpError(400, 'Give the sprint a name.');
      if (!start || !end || end < start) throw new HttpError(400, 'The end date must be after the start date.');
      const sprint = await Sprint.create({ project: project.key, name, goal, start, end });
      announce('sprint.changed', req, project);
      res.status(201).json(viewSprint(sprint));
    }));

    const sprintFor = async (req) => {
      const sprint = await Sprint.findById(req.params.id);
      if (!sprint) throw new HttpError(404, 'This sprint does not exist.');
      return { sprint, project: await projectFor(req, sprint.project, EDITORS) };
    };

    app.patch('/sprints/:id', wrap(async (req, res) => {
      const { sprint, project } = await sprintFor(req);
      const b = req.body;
      if ('name' in b) { if (!String(b.name).trim()) throw new HttpError(400, 'Give the sprint a name.'); sprint.name = b.name; }
      if ('goal' in b) sprint.goal = b.goal || '';
      if ('start' in b) sprint.start = b.start;
      if ('end' in b) sprint.end = b.end;
      if (!sprint.start || !sprint.end || sprint.end < sprint.start) throw new HttpError(400, 'The end date must be after the start date.');
      await sprint.save();
      announce('sprint.changed', req, project);
      res.json(viewSprint(sprint));
    }));

    app.post('/sprints/:id/start', wrap(async (req, res) => {
      const { sprint, project } = await sprintFor(req);
      const running = await Sprint.findOne({ project: project.key, state: 'active' });
      if (running) throw new HttpError(409, `Complete ${running.name} first. Only one sprint can be active.`);
      sprint.state = 'active';
      await sprint.save();
      announce('sprint.changed', req, project);
      res.json(viewSprint(sprint));
    }));

    // Done issues stay with the finished sprint; open ones move to another sprint or the backlog.
    app.post('/sprints/:id/complete', wrap(async (req, res) => {
      const { sprint, project } = await sprintFor(req);
      const target = req.body.moveTo ? await Sprint.findOne({ _id: req.body.moveTo, project: project.key, state: 'planned' }) : null;
      if (req.body.moveTo && !target) throw new HttpError(400, 'Choose a sprint that has not started, or the backlog.');
      await Issue.updateMany({ sprint: sprint._id, status: { $ne: 'done' } }, { sprint: target?._id || null });
      sprint.state = 'done';
      await sprint.save();
      announce('sprint.changed', req, project);
      res.json(viewSprint(sprint));
    }));

    app.delete('/sprints/:id', wrap(async (req, res) => {
      const { sprint, project } = await sprintFor(req);
      if (sprint.state !== 'planned') throw new HttpError(400, 'Only a sprint that has not started can be deleted.');
      await Issue.updateMany({ sprint: sprint._id }, { sprint: null });
      await sprint.deleteOne();
      announce('sprint.changed', req, project);
      res.status(204).end();
    }));
  },
});
