// Micro-frontend: the work itself — spaces, backlog, board, issue list, people and issues.
import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ask, createRemote, navigate, session, useUsers } from '@scrumwise/ui';
import { Backlog } from './Backlog.jsx';
import { Board } from './Board.jsx';
import { CreateIssue, IssueModal } from './IssueModal.jsx';
import { ForYou, List, People, Spaces } from './pages.jsx';
import { changeRequested, spaceOpened, store } from './store.js';

function SpacePages({ view, projectKey, query }) {
  const dispatch = useDispatch();
  const { data, error, key } = useSelector((state) => state.work);
  const users = useUsers();
  const me = session.get()?.user;
  useEffect(() => { dispatch(spaceOpened(projectKey)); }, [dispatch, projectKey]); // the saga loads it

  if (error) return <section className="page"><div className="empty"><p><b>{error}</b></p><a className="btn primary" href="#/spaces">Go to Spaces</a></div></section>;
  if (!data || key !== projectKey) return <section className="page"><p className="muted">Loading…</p></section>;

  const here = `#/p/${projectKey}/${view}`;
  const role = data.project.members.find((m) => m.user === me.id)?.role;
  const shared = {
    data, users, me, role,
    // Sends a change to the server and resolves when it is done and the page's data is fresh.
    // Resolves with the server's answer, or undefined if it failed (the person has already been told).
    act: (mutation, variables, success) => ask(dispatch, changeRequested({ mutation, variables, success })),
    canEdit: role === 'Administrator' || role === 'Member',
    team: data.project.members.filter((m) => m.role !== 'Client').map((m) => m.user), // people who can be assigned work
    open: (issueKey) => navigate(`${here}?issue=${issueKey}`),
  };
  const issue = query.issue && data.issues.find((i) => i.key === query.issue);
  const Page = { backlog: Backlog, board: Board, list: List, people: People }[view] || Backlog;

  return (
    <>
      <Page {...shared} />
      {issue && <IssueModal {...shared} issue={issue} onClose={() => navigate(here)} />}
      {query.create && <CreateIssue {...shared} onClose={() => navigate(here)} />}
    </>
  );
}

export function App({ view = 'for-you', projectKey, query = {} }) {
  if (view === 'for-you') return <ForYou />;
  if (view === 'spaces') return <Spaces create={!!query.create} />;
  return <SpacePages view={view} projectKey={projectKey} query={query} />;
}

export const mount = createRemote(App, store);
