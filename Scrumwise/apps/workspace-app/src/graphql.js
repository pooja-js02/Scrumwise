// Every GraphQL question (Q) and change (M) this micro-frontend sends.
const SPACE = 'key name lead hue members { user role } columns { id name cat }';
const ISSUE = `key project type title desc status priority points assignee reporter sprint labels
  comments { id by byName text at parent } history { by byName text at } createdAt updatedAt`;

export const Q = {
  spaces: `{ spaces { ${SPACE} issueCount } }`,
  mine: '{ myIssues { key project projectName type title status statusName statusCat priority } }',
  space: `query ($key: ID!) { space(key: $key) { project { ${SPACE} } sprints { id project name goal start end state } issues { ${ISSUE} } } }`,
};

export const M = {
  createSpace: 'mutation ($name: String!, $key: String!) { createSpace(name: $name, key: $key) { key } }',
  addMember: 'mutation ($space: ID!, $user: ID!, $role: String) { addMember(space: $space, user: $user, role: $role) { key } }',
  setMemberRole: 'mutation ($space: ID!, $user: ID!, $role: String!) { setMemberRole(space: $space, user: $user, role: $role) { key } }',
  setColumns: 'mutation ($space: ID!, $columns: [ColumnInput!]!) { setColumns(space: $space, columns: $columns) { key } }',
  removeMember: 'mutation ($space: ID!, $user: ID!) { removeMember(space: $space, user: $user) { key } }',

  createIssue: 'mutation ($space: ID!, $input: IssueInput!) { createIssue(space: $space, input: $input) { key } }',
  updateIssue: 'mutation ($key: ID!, $input: IssueInput!) { updateIssue(key: $key, input: $input) { key } }',
  deleteIssue: 'mutation ($key: ID!) { deleteIssue(key: $key) }',
  addComment: 'mutation ($issue: ID!, $text: String!, $parent: ID) { addComment(issue: $issue, text: $text, parent: $parent) { key } }',
  deleteComment: 'mutation ($issue: ID!, $id: ID!) { deleteComment(issue: $issue, id: $id) { key } }',

  createSprint: 'mutation ($space: ID!, $input: SprintInput!) { createSprint(space: $space, input: $input) { id } }',
  updateSprint: 'mutation ($id: ID!, $input: SprintInput!) { updateSprint(id: $id, input: $input) { id } }',
  startSprint: 'mutation ($id: ID!) { startSprint(id: $id) { id } }',
  completeSprint: 'mutation ($id: ID!, $moveTo: ID) { completeSprint(id: $id, moveTo: $moveTo) { id } }',
  deleteSprint: 'mutation ($id: ID!) { deleteSprint(id: $id) }',

  openDirectMessage: 'mutation ($user: ID!) { openDirectMessage(user: $user) { id } }',
};
