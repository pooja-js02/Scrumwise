// Fills an empty database with a demo space, people, issues and messages, through the GraphQL API.
// Safe to run again: if the demo account already exists it does nothing.
//
//   docker compose run --rm seed        (runs automatically on "docker compose up")
//   GATEWAY_URL=http://localhost:8080 node scripts/seed.mjs

const URL = `${process.env.GATEWAY_URL || 'http://localhost:8080'}/api/graphql`;
const PASSWORD = 'demo1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends one GraphQL request and returns its data, or throws the first error.
async function gql(query, variables = {}, token) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors[0].message);
  return data;
}
const LOGIN = 'mutation ($email: String!, $password: String!) { login(email: $email, password: $password) { token } }';

// Wait until the gateway and the auth service answer (they take a moment to start).
async function waitUntilReady() {
  for (let attempt = 1; attempt <= 90; attempt++) {
    try {
      await gql(LOGIN, { email: 'nobody@example.com', password: 'x' });
    } catch (err) {
      if (err.message.startsWith('Incorrect email')) return; // the auth service answered, as expected
    }
    await sleep(2000);
  }
  throw new Error('The services did not become ready in time.');
}

const PEOPLE = [
  ['maya', 'Maya Chen', 'maya.chen@atlas.example', 'Tech lead', 'Administrator'],
  ['dev', 'Dev Malhotra', 'dev.malhotra@atlas.example', 'Backend developer', 'Member'],
  ['sara', 'Sara Okafor', 'sara.okafor@atlas.example', 'Frontend developer', 'Member'],
  ['tomas', 'Tomás Rivera', 'tomas.rivera@atlas.example', 'Backend developer', 'Member'],
  ['li', 'Li Wei', 'li.wei@atlas.example', 'Designer', 'Member'],
  ['olivia', 'Olivia Grant', 'olivia.grant@northwind.example', 'Client · product owner', 'Client'],
  ['rahul', 'Rahul Mehta', 'rahul.mehta@northwind.example', 'Client · finance lead', 'Client'],
];

await waitUntilReady();

try {
  await gql(LOGIN, { email: PEOPLE[0][2], password: PASSWORD });
  console.log('[seed] demo data already exists — nothing to do.');
  process.exit(0);
} catch { /* not seeded yet */ }

console.log('[seed] creating demo data…');
const who = {};
for (const [id, name, email, title, role] of PEOPLE) {
  const { signup } = await gql('mutation ($name: String!, $email: String!, $password: String!, $title: String) { signup(name: $name, email: $email, password: $password, title: $title) { token user { id } } }', { name, email, title, password: PASSWORD });
  who[id] = { token: signup.token, id: signup.user.id, role };
}
const as = (id) => who[id].token;

await gql('mutation { createSpace(name: "Atlas Checkout", key: "PAY") { key } }', {}, as('maya'));
for (const id of Object.keys(who).filter((x) => x !== 'maya')) {
  await gql('mutation ($user: ID!, $role: String) { addMember(space: "PAY", user: $user, role: $role) { key } }', { user: who[id].id, role: who[id].role }, as('maya'));
}

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const { createSprint: sprint } = await gql('mutation ($input: SprintInput!) { createSprint(space: "PAY", input: $input) { id } }', { input: { name: 'PAY Sprint 1', goal: 'Checkout v2 ready for the beta group', start: day(-7), end: day(6) } }, as('maya'));
await gql('mutation ($id: ID!) { startSprint(id: $id) { id } }', { id: sprint.id }, as('maya'));

const ISSUES = [
  ['story', 'Saved cards on checkout', 'done', 'sara', 5, 'Medium', true],
  ['bug', 'Payment fails when a card expires mid-session', 'doing', 'tomas', 3, 'High', true, 'If a saved card expires while the customer is on the checkout page, the payment call returns a 500 instead of asking for another card.'],
  ['task', 'Move webhook handler onto the queue', 'review', 'dev', 5, 'Medium', true],
  ['story', 'Apple Pay button on the cart page', 'doing', 'li', 8, 'Medium', true],
  ['task', 'Refund API: partial refunds', 'doing', 'maya', 5, 'High', true],
  ['bug', 'Wrong tax shown for EU business customers', 'todo', 'sara', 3, 'High', true],
  ['story', 'Show order summary before payment', 'review', 'dev', 5, 'Medium', true],
  ['task', 'Rate-limit the checkout endpoint', 'todo', null, 2, 'Medium', true],
  ['bug', 'Double charge when a slow request is retried', 'review', 'maya', 5, 'Highest', true],
  ['story', 'Show prices in the customer’s currency', 'todo', null, 8, 'Medium', false],
  ['task', 'Audit log for refunds', 'todo', null, 3, 'Medium', false],
  ['story', 'Pay by bank transfer', 'todo', null, 13, 'Low', false],
  ['task', 'Remove the legacy PayPal SDK', 'todo', null, 2, 'Lowest', false],
];
const keys = [];
for (const [type, title, status, assignee, points, priority, inSprint, desc] of ISSUES) {
  const input = { type, title, status, points, priority, desc, assignee: assignee ? who[assignee].id : null, sprint: inSprint ? sprint.id : null };
  keys.push((await gql('mutation ($input: IssueInput!) { createIssue(space: "PAY", input: $input) { key } }', { input }, as('maya'))).createIssue.key);
}
const COMMENT = 'mutation ($issue: ID!, $text: String!, $parent: ID) { addComment(issue: $issue, text: $text, parent: $parent) { comments { id } } }';
const comment = async (id, text, parent) => (await gql(COMMENT, { issue: keys[2], text, parent }, as(id))).addComment.comments.at(-1).id;
const top = await comment('tomas', 'I can review this tomorrow morning. Does the worker retry when the provider times out?');
const reply = await comment('dev', 'Yes, up to five times, waiting longer after each try.', top);
await comment('tomas', 'Good. Then I will only check the logging.', reply);

// The chat service creates #general and #issues when it hears about the new space; wait for them.
// Everyone must be in them before they can post.
let channels = [];
const ready = () => channels.length >= 2 && channels.every((c) => c.members.length === PEOPLE.length);
for (let attempt = 0; attempt < 40 && !ready(); attempt++) {
  channels = (await gql('{ channels(project: "PAY") { id name members } }', {}, as('maya'))).channels;
  if (!ready()) await sleep(500);
}
const channel = (name) => channels.find((c) => c.name === name)?.id;
const say = (id, channelId, text) => gql('mutation ($channel: ID!, $text: String!) { sendMessage(channel: $channel, text: $text) { id } }', { channel: channelId, text }, as(id));

if (channel('general')) {
  await say('olivia', channel('general'), 'Good morning all. Are we still on track to open the beta next week?');
  await say('maya', channel('general'), 'Yes. Two fixes are in review, and saved cards shipped this morning.');
  await say('olivia', channel('general'), 'Tried it, looks great. Can the receipt email show our new logo too?');
}
if (channel('issues')) {
  await say('rahul', channel('issues'), `Finance found 14 customers who were charged twice last week. Is this ${keys[8]}?`);
  await say('maya', channel('issues'), `Yes, ${keys[8]}. The fix is in review and stops any repeat charge.`);
  await say('olivia', channel('issues'), `For ${keys[5]}: Germany and France showed the wrong tax so far.`);
}
const { createChannel: devTeam } = await gql('mutation ($input: ChannelInput!) { createChannel(input: $input) { id } }',
  { input: { project: 'PAY', name: 'dev-team', about: 'Developers only.', private: true, members: ['dev', 'sara', 'tomas', 'li'].map((id) => who[id].id) } }, as('maya'));
await say('tomas', devTeam.id, 'Staging will be down for ten minutes at 15:00 for the load test.');

const { openDirectMessage: dm } = await gql('mutation ($user: ID!) { openDirectMessage(user: $user) { id } }', { user: who.maya.id }, as('dev'));
await say('dev', dm.id, 'PR #482 is open for the order summary step, when you have a minute.');

console.log(`[seed] done. Log in with ${PEOPLE[0][2]} / ${PASSWORD} (every demo account uses that password).`);
