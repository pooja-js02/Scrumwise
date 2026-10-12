// The OpenAPI (Swagger) description of the REST API served at /api/v1.
// It is written with a few small helpers so each endpoint reads as one or two lines.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const list = (name) => ({ type: 'array', items: ref(name) });
const json = (schema) => ({ content: { 'application/json': { schema } } });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const path = (name, description) => ({ name, in: 'path', required: true, description, schema: { type: 'string' } });

const ERRORS = {
  400: { description: 'The request was not valid. The message says what to fix.', ...json(ref('Error')) },
  401: { description: 'Not logged in, or the token is no longer valid.', ...json(ref('Error')) },
  403: { description: 'Logged in, but your role does not allow this.', ...json(ref('Error')) },
  404: { description: 'It does not exist, or you are not a member of it.', ...json(ref('Error')) },
  409: { description: 'It conflicts with something that already exists.', ...json(ref('Error')) },
};

// One endpoint. `ok` is the schema returned on success (omit it for "204 No Content").
function op(tag, summary, { description, params = [], body, required = [], ok, status = 200, errors = [401], open = false } = {}) {
  return {
    tags: [tag],
    summary,
    ...(description ? { description } : {}),
    ...(open ? { security: [] } : {}),
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: { required: true, ...json({ type: 'object', properties: body, ...(required.length ? { required } : {}) }) } } : {}),
    responses: {
      [ok ? status : 204]: ok ? { description: 'Success.', ...json(ok) } : { description: 'Done. Nothing is returned.' },
      ...Object.fromEntries(errors.map((code) => [code, ERRORS[code]])),
    },
  };
}

const KEY = path('key', 'The space key, for example `PAY`.');
const ISSUE = path('key', 'The issue key, for example `PAY-12`.');
const CHANNEL = path('id', 'The channel or direct-message conversation id.');
const ROLES = ['Administrator', 'Member', 'Viewer', 'Client'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const issueFields = {
  type: str('The kind of work.', { enum: ['story', 'bug', 'task'] }),
  title: str('The summary.'),
  desc: str('The description.'),
  status: str('The id of the board column the issue is in. `todo`, `doing`, `review` and `done` exist by default; a space can add its own.'),
  priority: str('How urgent it is.', { enum: PRIORITIES }),
  points: { type: 'integer', nullable: true, description: 'Story points.' },
  assignee: str('User id of the assignee, or null for nobody.', { nullable: true }),
  sprint: str('Sprint id, or null for the backlog.', { nullable: true }),
  labels: { type: 'array', items: { type: 'string' } },
};

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Scrumwise API',
    version: '1.0.0',
    description: [
      'The REST API of Scrumwise: spaces, sprints, issues, chat and notifications.',
      '',
      '**To try it:** run `POST /auth/login` with the demo account below, copy the `token` from the answer,',
      'press **Authorize** at the top of this page and paste it. Every other request then runs as that person.',
      '',
      'Demo account: `maya.chen@atlas.example` / `demo1234`',
      '',
      'The web app itself uses the GraphQL API at `/api/graphql`, which offers the same operations.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1', description: 'This gateway' }],
  security: [{ bearer: [] }],
  tags: [
    { name: 'Auth', description: 'Sign up and log in. These need no token.' },
    { name: 'People', description: 'Accounts and your own profile.' },
    { name: 'Spaces', description: 'Spaces (projects) and who belongs to them.' },
    { name: 'Issues', description: 'Issues and their comments.' },
    { name: 'Sprints', description: 'Plan, start and complete sprints.' },
    { name: 'Chat', description: 'Channels, direct messages, reactions and read receipts.' },
    { name: 'Notifications', description: 'What happened that concerns you.' },
  ],
  paths: {
    // ----- auth -----
    '/auth/signup': { post: op('Auth', 'Create an account', { open: true, status: 201, ok: ref('Session'), errors: [400, 409],
      body: { name: str('Full name.', { example: 'Priya Nair' }), email: str('Email address.', { example: 'priya@example.com' }), password: str('At least 8 characters.', { example: 'longenough1' }), title: str('Job title (optional).') }, required: ['name', 'email', 'password'] }) },
    '/auth/login': { post: op('Auth', 'Log in', { open: true, ok: ref('Session'), errors: [401], description: 'Returns a token that is valid for 7 days.',
      body: { email: str('Email address.', { example: 'maya.chen@atlas.example' }), password: str('Password.', { example: 'demo1234' }) }, required: ['email', 'password'] }) },

    // ----- people -----
    '/users': { get: op('People', 'List everyone with an account', { ok: list('User') }) },
    '/users/me': {
      get: op('People', 'Your own account', { ok: ref('User') }),
      patch: op('People', 'Change your name, job title or password', { ok: ref('Session'), errors: [400, 401], description: 'Send only what you want to change. To change the password send both `currentPassword` and `newPassword`. Returns a new token, because your name is inside it.', body: { name: str('Full name.'), title: str('Job title.'), timeZone: str('An IANA time zone such as `Asia/Kolkata`, or empty to use the device\'s zone.'), hour24: { type: 'boolean', description: 'Show times on a 24-hour clock.' }, home: str('The page shown after logging in.', { enum: ['for-you', 'spaces', 'board'] }), currentPassword: str('Your password now.'), newPassword: str('The new password, at least 8 characters.') } }),
    },

    // ----- spaces -----
    '/projects': {
      get: op('Spaces', 'List the spaces you belong to', { ok: list('Space') }),
      post: op('Spaces', 'Create a space', { status: 201, ok: ref('Space'), errors: [400, 401, 409], description: 'You become its Administrator. Two channels, #general and #issues, are created for it.',
        body: { name: str('The space name.', { example: 'Marketing Website' }), key: str('2 to 5 letters; the prefix of every issue.', { example: 'WEB' }) }, required: ['name', 'key'] }),
    },
    '/projects/{key}': { get: op('Spaces', 'Everything in a space', { params: [KEY], ok: ref('SpaceData'), errors: [401, 404], description: 'The space, its sprints and all its issues in one answer.' }) },
    '/projects/{key}/members': { post: op('Spaces', 'Add a person to a space', { params: [KEY], status: 201, ok: ref('Space'), errors: [400, 401, 403, 404, 409], description: 'Administrators only.',
      body: { userId: str('The id of the person to add.'), role: str('Their role.', { enum: ROLES, default: 'Member' }) }, required: ['userId'] }) },
    '/projects/{key}/members/{userId}': {
      patch: op('Spaces', 'Change a member\'s role', { params: [KEY, path('userId', 'The member\'s user id.')], ok: ref('Space'), errors: [400, 401, 403, 404], body: { role: str('The new role.', { enum: ROLES }) }, required: ['role'] }),
      delete: op('Spaces', 'Remove a person from a space', { params: [KEY, path('userId', 'The member\'s user id.')], ok: ref('Space'), errors: [400, 401, 403, 404], description: 'Their issues become unassigned.' }),
    },
    '/projects/{key}/columns': { put: op('Spaces', 'Set the board columns', { params: [KEY], ok: ref('Space'), errors: [400, 401, 403, 404],
      description: 'The columns work moves through, in order. Send the whole list: keep a column by sending its `id`, add one by leaving `id` out. The `todo` and `done` columns can be renamed but not removed. Issues in a removed column go back to the first column.',
      body: { columns: { type: 'array', items: ref('Column') } }, required: ['columns'] }) },

    // ----- issues -----
    '/issues/mine': { get: op('Issues', 'Open issues assigned to you, in every space', { ok: list('Issue') }) },
    '/projects/{key}/issues': { post: op('Issues', 'Create an issue', { params: [KEY], status: 201, ok: ref('Issue'), errors: [400, 401, 403, 404], body: issueFields, required: ['title'] }) },
    '/issues/{key}': {
      get: op('Issues', 'One issue', { params: [ISSUE], ok: ref('Issue'), errors: [401, 404] }),
      patch: op('Issues', 'Change an issue', { params: [ISSUE], ok: ref('Issue'), errors: [400, 401, 403, 404], description: 'Send only the fields you want to change. Each change is added to the issue\'s history.', body: issueFields }),
      delete: op('Issues', 'Delete an issue', { params: [ISSUE], errors: [401, 403, 404] }),
    },
    '/issues/{key}/comments': { post: op('Issues', 'Comment on an issue, or reply to a comment', { params: [ISSUE], status: 201, ok: ref('Issue'), errors: [400, 401, 403, 404],
      body: { text: str('The comment.'), parent: str('The id of the comment being replied to (optional).', { nullable: true }) }, required: ['text'] }) },
    '/issues/{key}/comments/{id}': { delete: op('Issues', 'Delete a comment and every reply under it', { params: [ISSUE, path('id', 'The comment id.')], ok: ref('Issue'), errors: [401, 403, 404], description: 'You can delete your own comments; Administrators can delete any.' }) },

    // ----- sprints -----
    '/projects/{key}/sprints': { post: op('Sprints', 'Create a sprint', { params: [KEY], status: 201, ok: ref('Sprint'), errors: [400, 401, 403, 404],
      body: { name: str('The sprint name.', { example: 'PAY Sprint 2' }), goal: str('What should be true when it ends.'), start: str('First day.', { format: 'date', example: '2026-10-19' }), end: str('Last day.', { format: 'date', example: '2026-11-01' }) }, required: ['name', 'start', 'end'] }) },
    '/sprints/{id}/start': { post: op('Sprints', 'Start a sprint', { params: [path('id', 'The sprint id.')], ok: ref('Sprint'), errors: [401, 403, 404, 409], description: 'Only one sprint can be active in a space at a time.' }) },
    '/sprints/{id}/complete': { post: op('Sprints', 'Complete a sprint', { params: [path('id', 'The sprint id.')], ok: ref('Sprint'), errors: [400, 401, 403, 404], description: 'Done issues stay with the sprint. Open issues move to `moveTo`, or to the backlog.',
      body: { moveTo: str('The id of a sprint that has not started, or null for the backlog.', { nullable: true }) } }) },
    '/sprints/{id}': {
      patch: op('Sprints', 'Edit a sprint', { params: [path('id', 'The sprint id.')], ok: ref('Sprint'), errors: [400, 401, 403, 404], description: 'Change its name, goal or dates. Send only what you want to change.',
        body: { name: str('The sprint name.'), goal: str('What should be true when it ends.'), start: str('First day.', { format: 'date' }), end: str('Last day.', { format: 'date' }) } }),
      delete: op('Sprints', 'Delete a sprint that has not started', { params: [path('id', 'The sprint id.')], errors: [400, 401, 403, 404], description: 'Its issues go back to the backlog.' }),
    },

    // ----- chat -----
    '/channels': {
      get: op('Chat', 'List the channels you are in', { params: [{ name: 'project', in: 'query', description: 'Only channels of this space key.', schema: { type: 'string' } }], ok: list('Channel') }),
      post: op('Chat', 'Create a channel', { status: 201, ok: ref('Channel'), errors: [400, 401, 409],
        body: { project: str('The space key.', { example: 'PAY' }), name: str('The channel name.', { example: 'release-updates' }), about: str('What it is for.'), private: { type: 'boolean', description: 'People who join the space later are not added.' }, members: { type: 'array', items: { type: 'string' }, description: 'User ids to add. You are always added.' } }, required: ['project', 'name'] }),
    },
    '/channels/{id}': {
      get: op('Chat', 'One conversation, with unread count and read receipts', { params: [CHANNEL], ok: ref('Channel'), errors: [401, 404] }),
      delete: op('Chat', 'Delete a conversation', { params: [CHANNEL], errors: [400, 401, 403, 404], description: 'A direct message is deleted for you only: its history is cleared on your side. A channel is deleted for everyone, and only by the person who created it. #general and #issues cannot be deleted.' }),
    },
    '/channels/{id}/mute': { post: op('Chat', 'Mute or unmute a conversation', { params: [CHANNEL], ok: ref('Channel'), errors: [401, 404], description: 'While muted you get no notifications for it. Only affects you.', body: { muted: { type: 'boolean', default: true } } }) },
    '/channels/{id}/hide': { post: op('Chat', 'Hide or show a conversation', { params: [CHANNEL], ok: ref('Channel'), errors: [401, 404], description: 'A hidden conversation leaves your sidebar until someone writes in it again. Only affects you.', body: { hidden: { type: 'boolean', default: true } } }) },
    '/channels/{id}/messages': {
      get: op('Chat', 'The messages of a conversation', { params: [CHANNEL], ok: list('Message'), errors: [401, 404], description: 'The latest 200, oldest first. Asking for them marks the conversation as read.' }),
      post: op('Chat', 'Send a message', { params: [CHANNEL], status: 201, ok: ref('Message'), errors: [400, 401, 404], body: { text: str('The message. Supports **bold**, _italic_, `code`, lists and links.'), replyTo: str('The id of the message being replied to (optional).', { nullable: true }) }, required: ['text'] }),
    },
    '/channels/{id}/messages/{mid}': {
      patch: op('Chat', 'Edit your message', { params: [CHANNEL, path('mid', 'The message id.')], ok: ref('Message'), errors: [400, 401, 403, 404], body: { text: str('The new text.') }, required: ['text'] }),
      delete: op('Chat', 'Delete your message for everyone', { params: [CHANNEL, path('mid', 'The message id.')], errors: [401, 403, 404], description: 'It disappears from the conversation and from other people\'s notifications.' }),
    },
    '/channels/{id}/messages/{mid}/reactions': { post: op('Chat', 'Add or remove your reaction', { params: [CHANNEL, path('mid', 'The message id.')], ok: ref('Message'), errors: [400, 401, 404], description: 'Sending the same emoji again takes your reaction away.',
      body: { emoji: str('One of the available reactions.', { enum: ['👍', '❤️', '😂', '🎉', '😮', '🙏'] }) }, required: ['emoji'] }) },
    '/channels/{id}/read': { post: op('Chat', 'Mark a conversation as read', { params: [CHANNEL], errors: [401, 404] }) },
    '/dms': {
      get: op('Chat', 'Your direct-message conversations', { ok: list('Channel'), description: 'Only conversations that have at least one message.' }),
      post: op('Chat', 'Open the conversation with a person', { ok: ref('Channel'), errors: [400, 401], description: 'Finds it, or creates it the first time.', body: { userId: str('The other person\'s user id.') }, required: ['userId'] }),
    },

    // ----- notifications -----
    '/notifications': { get: op('Notifications', 'Your latest notifications', { ok: ref('Notifications') }) },
    '/notifications/settings': {
      get: op('Notifications', 'What you are notified about', { ok: ref('NotificationSettings') }),
      put: op('Notifications', 'Choose what you are notified about', { ok: ref('NotificationSettings'), description: 'Send only the parts you want to change. In-product choices take effect at once. Email and digest choices are stored, but this server does not send email yet.', body: { ...{ message: { type: 'boolean', description: 'Direct messages.' }, channel: { type: 'boolean', description: 'Messages in channels.' }, board: { type: 'boolean', description: 'Issues moving on the board.' }, assigned: { type: 'boolean', description: 'Issues assigned to you.' }, comment: { type: 'boolean', description: 'Comments on your issues.' } }, email: { type: 'object' }, emailKinds: { type: 'object' }, spaces: { type: 'array', items: { type: 'object' } }, digests: { type: 'object' } } }),
    },
    '/notifications/read': { post: op('Notifications', 'Mark notifications as read', { description: 'Send an id to mark one, or nothing to mark all.', body: { id: str('A notification id (optional).') } }) },
  },

  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The `token` returned by `POST /auth/login`.' } },
    schemas: {
      Error: { type: 'object', properties: { error: str('What went wrong, in plain words.') } },
      User: { type: 'object', properties: { id: str('User id.'), name: str('Full name.'), email: str('Email address.'), title: str('Job title.'), hue: { type: 'integer', description: 'Avatar colour, 0–359.' }, timeZone: str('Chosen time zone; empty means the device\'s zone.'), hour24: { type: 'boolean', description: '24-hour clock.' } } },
      Session: { type: 'object', properties: { token: str('Send this as `Authorization: Bearer <token>`.'), user: ref('User') } },
      Member: { type: 'object', properties: { user: str('User id.'), role: str('Role in the space.', { enum: ROLES }) } },
      Column: { type: 'object', properties: { id: str('Column id. Leave it out to add a new column.'), name: str('What the column is called.'), cat: str('Its colour group.', { enum: ['todo', 'doing', 'review', 'done'] }) } },
      Space: { type: 'object', properties: { key: str('For example `PAY`.'), name: str('The space name.'), lead: str('User id of the lead.'), hue: { type: 'integer' }, members: list('Member'), columns: list('Column'), issues: { type: 'integer', description: 'How many issues it has (only in the list of spaces).' } } },
      Sprint: { type: 'object', properties: { id: str('Sprint id.'), project: str('Space key.'), name: str('Name.'), goal: str('Goal.'), start: str('First day.', { format: 'date' }), end: str('Last day.', { format: 'date' }), state: str('Where the sprint is.', { enum: ['planned', 'active', 'done'] }) } },
      Comment: { type: 'object', properties: { id: str('Comment id.'), by: str('User id of the author.'), byName: str('Author name.'), text: str('The comment.'), at: str('When.', { format: 'date-time' }), parent: str('The comment this replies to.', { nullable: true }) } },
      HistoryEntry: { type: 'object', properties: { by: str('User id.'), byName: str('Name.'), text: str('What changed.'), at: str('When.', { format: 'date-time' }) } },
      Issue: { type: 'object', properties: { key: str('For example `PAY-12`.'), project: str('Space key.'), ...issueFields, reporter: str('User id of the creator.'), comments: list('Comment'), history: list('HistoryEntry'), createdAt: str('When it was created.', { format: 'date-time' }), updatedAt: str('When it last changed.', { format: 'date-time' }) } },
      SpaceData: { type: 'object', properties: { project: ref('Space'), sprints: list('Sprint'), issues: list('Issue') } },
      Reaction: { type: 'object', properties: { emoji: str('The reaction.'), user: str('User id of who reacted.') } },
      ReplyRef: { type: 'object', description: 'The message being replied to. If it was deleted, only `id` and `deleted` are set.', properties: { id: str('Message id.'), fromName: str('Its author.'), text: str('Its text.'), deleted: { type: 'boolean' } } },
      Message: { type: 'object', properties: { id: str('Message id.'), channel: str('Conversation id.'), from: str('User id of the sender.'), fromName: str('Sender name.'), text: str('The message.'), at: str('When it was sent.', { format: 'date-time' }), editedAt: str('When it was last edited.', { format: 'date-time', nullable: true }), reactions: list('Reaction'), replyTo: ref('ReplyRef') } },
      Read: { type: 'object', properties: { user: str('User id.'), at: str('When they last read the conversation.', { format: 'date-time' }) } },
      Channel: { type: 'object', properties: { id: str('Conversation id.'), kind: str('A channel or a direct message.', { enum: ['channel', 'dm'] }), project: str('Space key (channels only).', { nullable: true }), name: str('Channel name.'), about: str('What it is for.'), private: { type: 'boolean' }, members: { type: 'array', items: { type: 'string' }, description: 'User ids.' }, other: str('For a direct message: the other person\'s user id.', { nullable: true }), unread: { type: 'integer', description: 'Messages you have not read.' }, last: ref('Message'), reads: list('Read'), muted: { type: 'boolean', description: 'You have muted it.' }, hidden: { type: 'boolean', description: 'You have hidden it.' }, canDelete: { type: 'boolean', description: 'You may delete it.' } } },
      Notification: { type: 'object', properties: { id: str('Notification id.'), kind: str('What it is about.', { enum: ['message', 'channel', 'board', 'issue'] }), text: str('The headline.'), detail: str('The detail.'), read: { type: 'boolean' }, at: str('When.', { format: 'date-time' }), link: { type: 'object', description: 'Where it points.', properties: { project: str('Space key.'), channelId: str('Conversation id.'), issueKey: str('Issue key.') } } } },
      NotificationSettings: { type: 'object', properties: { ...{ message: { type: 'boolean', description: 'Direct messages.' }, channel: { type: 'boolean', description: 'Messages in channels.' }, board: { type: 'boolean', description: 'Issues moving on the board.' }, assigned: { type: 'boolean', description: 'Issues assigned to you.' }, comment: { type: 'boolean', description: 'Comments on your issues.' } },
        email: { type: 'object', description: 'Email preferences.', properties: { on: { type: 'boolean' }, assignee: { type: 'boolean' }, reporter: { type: 'boolean' }, own: { type: 'boolean' }, group: { type: 'boolean' }, every: { type: 'integer', enum: [3, 10, 30, 60], description: 'Minutes between grouped emails.' }, format: str('Email format.', { enum: ['html', 'text'] }) } },
        emailKinds: { type: 'object', description: 'Which news may also be emailed.', properties: { assigned: { type: 'boolean' }, board: { type: 'boolean' }, comment: { type: 'boolean' } } },
        spaces: { type: 'array', description: 'Spaces with their own choice. Replaced as a whole.', items: { type: 'object', properties: { key: str('Space key.'), inApp: { type: 'boolean' }, email: { type: 'boolean' } } } },
        digests: { type: 'object', properties: { due: { type: 'object', properties: { on: { type: 'boolean' }, email: { type: 'boolean' }, inApp: { type: 'boolean' } } }, weekly: { type: 'object', properties: { on: { type: 'boolean' }, email: { type: 'boolean' } } } } },
      } },
      Notifications: { type: 'object', properties: { unread: { type: 'integer' }, list: list('Notification') } },
    },
  },
};
