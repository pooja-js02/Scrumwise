# Scrumwise: the problem and how the application helps

**Product:** Scrumwise, a project tracker with built-in team chat
**Date:** 2026-10-12
**Describes:** the application as built in `Scrumwise/`

---

## 1. The problem in one paragraph

A software team plans its work in one tool and talks about it in another. The tracker (Jira, Trello)
holds the issues and the sprint. The chat tool (Slack, Teams) holds the questions, the decisions and
the "can you look at this?" messages. The two do not know about each other, so people copy links back
and forth, decisions made in chat never reach the issue, and a client who wants to know how things
are going needs an account, and often a paid seat, in both. For a small team or an agency, that is
two subscriptions, two sets of notifications and two places where the truth might be.

## 2. What Scrumwise does

Scrumwise puts the tracker and the conversation in one application. Each project, called a *space*,
has its backlog, sprints and board, and beside them its own chat channels and direct messages. The
team and the client work in the same place, each seeing what their role allows.

## 3. The problems, one by one

### 3.1 Work and conversation live in different tools

| | |
|---|---|
| **Problem** | An issue is discussed in chat, a decision is made, and the issue itself still says nothing. Someone joining later has to search two tools to understand what happened. |
| **How Scrumwise helps** | Every space has its chat in the sidebar next to its board. A space starts with two channels: `#general` for the team and `#issues` for discussing issues together. Issues have their own comment threads with replies, so a decision about one issue can be written on that issue. |

### 3.2 Clients are kept outside, or let too far inside

| | |
|---|---|
| **Problem** | A client is either sent status reports by email, which takes time and goes stale, or given full access to a tool built for the team. |
| **How Scrumwise helps** | Each member of a space has a role: Administrator, Member, Viewer or Client. A Client can see the board and the backlog, comment on issues and take part in chat, but cannot move issues, edit sprints or change the board. Private channels let the team talk without the client. |

### 3.3 Nobody is sure the board is current

| | |
|---|---|
| **Problem** | A board is only trusted if it is up to date. When changes appear only after a page refresh, people stop looking at it and ask in chat instead. |
| **How Scrumwise helps** | Changes arrive live. When someone moves an issue, edits a sprint or sends a message, everyone looking at that space sees it without refreshing. A bell collects what concerns you: issues assigned to you, comments on your issues, board changes and new messages. |

### 3.4 The tool dictates the workflow

| | |
|---|---|
| **Problem** | Teams do not all work in "To Do, In Progress, Done". Some need a QA step, some a "Blocked" column. A tracker with fixed columns makes the team fit the tool. |
| **How Scrumwise helps** | Each space defines its own board columns: add, rename, colour, reorder and remove them. Only the first column (where new issues start) and the Done column (which reports count as finished) must stay. |

### 3.5 It is hard to see how a sprint is going

| | |
|---|---|
| **Problem** | "Will we finish this sprint?" is usually answered by feel. Stand-ups drift because there is nothing to walk through. |
| **How Scrumwise helps** | The board shows the days remaining. Sprint insights show the percentage completed, a burndown chart against the ideal line, and the workload per person. A stand-up mode steps through the team one person at a time, showing only that person's issues, with a timer. When the sprint ends, unfinished issues move to the next sprint or the backlog in one step. |

### 3.6 Too many notifications, or the wrong ones

| | |
|---|---|
| **Problem** | When every change produces a notification, people mute everything and then miss what matters. |
| **How Scrumwise helps** | Each person chooses which kinds of news reach their bell, can silence a whole space, and can mute or hide a single conversation. Times are shown in each person's own time zone, which matters when the team and the client are in different countries. |

## 4. Who it is for

- **Small software teams** that want sprints and a board without running a separate chat tool.
- **Agencies and freelancers** who work with clients and want them to see progress and ask questions in the same place.
- **Distributed teams** working across time zones.

## 5. What it covers today

| Area | Included |
|------|----------|
| Planning | Spaces, backlog, sprints (create, edit, start, complete), story points, priorities, labels |
| Board | Drag and drop, custom columns, filters by person and text, card view settings |
| Issues | Stories, bugs and tasks; description, assignee, comments with replies, full history |
| Sprint tools | Sprint details, insights with burndown, stand-up mode |
| Chat | Channels (public and private), direct messages, replies, reactions, edit and delete, read status |
| Notifications | Live bell, per-kind switches, per-space silence, mute and hide for conversations |
| People | Roles per space, profile, account settings, time zone and theme |
| For developers | REST and GraphQL APIs, documented with Swagger |

## 6. What it does not do yet

- **Email.** Notifications appear in the application only. Email and digest preferences can be set, but nothing is sent until a mail service is added.
- **Integrations.** There is no connection to GitHub, Slack or calendars.
- **Reporting beyond the sprint.** There is no timeline, roadmap or velocity history across sprints.
- **Languages.** The interface is in English only.
- **Hosting.** It runs with Docker on a developer's machine; it is not yet deployed publicly.
