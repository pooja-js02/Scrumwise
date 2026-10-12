# Scrumwise

A Jira-style project tracker with built-in team chat. The backend is split into microservices and the
frontend into micro-frontends. Everything runs in Docker.

## Run it

You need Docker. Nothing else has to be installed on your machine.

```bash
docker compose up
```

The first run downloads images and installs packages, so it takes a few minutes. After that it starts in
about 30 seconds. Then open **http://localhost:5170** and log in with:

- Email: `maya.chen@atlas.example`
- Password: `demo1234`

Six more demo people exist, all with the same password (see `scripts/seed.mjs`). Log in as a second
person in a private browser window to see chat and the board update live.

| Command | What it does |
|---------|--------------|
| `docker compose up` | Start everything. Add `-d` to run in the background. |
| `docker compose down` | Stop everything. **The database is kept.** |
| `docker compose down -v` | Stop everything and **delete the database**. |
| `docker compose logs -f api-gateway` | Follow the log of one part. |
| `./scripts/reset-demo.sh` | Empty the database and load the demo data again. |

### The database is kept between runs

MongoDB stores its files in a Docker volume called `scrumwise_mongo-data`. Stopping, restarting or
rebuilding the containers does not touch it. Demo data is loaded only when the database is empty.

## How it is put together

```
Browser ──► web-shell (5170) ──loads──► auth-app (5171)  workspace-app (5172)  chat-app (5173)
               │                     each with its own Redux store and sagas
               │
               └─ /api/graphql ──► api-gateway (8080) ──► auth · project · chat · notification services
     ws :8080/api/live  ◄── live updates (WebSocket, direct)  │
                                        each service has its own MongoDB database
                                        events between services: Protocol Buffers over NATS
```

| Technology | Where it is used |
|------------|------------------|
| **GraphQL** | The one API the browser uses. Schema in `services/api-gateway/src/schema.js`. |
| **NATS** | The message bus. Services publish events and react to each other's events. |
| **Protocol Buffers** | The format of every NATS message. Schema in `packages/common/proto/events.proto`. |
| **Redux + redux-saga** | State and server calls in the shell and each micro-frontend (`store.js` in each). |
| **MongoDB** | One database per service. |

### Microservices (`services/`)

| Service | Owns | Database |
|---------|------|----------|
| `api-gateway` | The single entry point: the GraphQL API and the live WebSocket to each browser. Checks the login token. | none |
| `auth-service` | Accounts, log in, sign up, the list of people. | `scrumwise_auth` |
| `project-service` | Spaces, members and roles, sprints, issues, comments. | `scrumwise_projects` |
| `chat-service` | Channels and direct messages, unread counts. | `scrumwise_chat` |
| `notification-service` | Turns events from the other services into notifications. | `scrumwise_notifications` |

**A request** from the browser is a GraphQL query or mutation sent to the gateway. The gateway's
resolver asks the one service that owns the data, over HTTP inside the Docker network.

**An event** is how services affect each other. They never call one another. A service publishes a
protobuf message to NATS (for example `issue.status_changed`, `chat.message`,
`project.member_added`) and any service that cares reacts. Each subject has one message type, set in
`packages/common/index.js`, so a service cannot publish a shape the others do not expect.

**A live update** reaches a browser when a service publishes to `push.<user id>`; the gateway
delivers it over a WebSocket. Each browser tab holds one, connected straight to the gateway; if it
drops, the tab reconnects within a second and reloads what it missed. `curl localhost:8080/api/live-status`
shows how many tabs are connected.

`packages/common` holds the code every service shares: database and NATS connection, protobuf
encoding, the HTTP server and error handling.

### REST API and Swagger

The same operations are also available as a REST API at `/api/v1`, for other tools and for testing.
**Swagger is at http://localhost:8080/api/docs** — every endpoint is listed with its fields and
answers, and each one can be run from the page. Log in with `POST /auth/login`, copy the token, press
**Authorize** and paste it. The description behind the page is `services/api-gateway/src/openapi.js`, also
served at `/api/openapi.json` for importing into Postman.

Try the GraphQL API by hand:

```bash
curl -s localhost:8080/api/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation { login(email: \"maya.chen@atlas.example\", password: \"demo1234\") { token } }"}'
```

### Micro-frontends (`apps/`)

| App | What it shows |
|-----|---------------|
| `web-shell` | The frame: top bar, sidebar, tabs, notifications and the router. Loads the others at run time. |
| `auth-app` | Log in and sign up. |
| `workspace-app` | For you, Spaces, Backlog, Board, List, People and the issue window. |
| `chat-app` | Channels and direct messages. |

Each micro-frontend is built into one file, `remoteEntry.js`, that exports `mount(element, props)`.
The shell imports that file from the micro-frontend's own server and mounts it. Each one bundles its own
React and Redux, so they can be built, deployed and even rewritten separately.

Inside each app the pattern is the same:

- **Components** read state with `useSelector` and dispatch actions. They never call the server.
- **`store.js`** holds the Redux slice (the state and how it changes) and the sagas.
- **Sagas** are the only code that talks to the server. They send GraphQL, put results into the store,
  and listen for live updates.
- **`graphql.js`** (in `workspace-app`) lists every query and mutation the app sends.

The apps share state only through the browser: the login session in `localStorage` and events on
`window` (`push` for live updates, `changed` when one app changes something another shows). The shell's
saga holds the live connection and re-sends each update as a `push` event. See `packages/ui`.

## Working on the code

Source folders are mounted into the containers, so saving a file is enough:

- **Services** restart automatically.
- **The shell** hot-reloads in the browser.
- **Micro-frontends** rebuild in about a second; refresh the browser to load the new build.

To work on one micro-frontend alone with hot reload: `npm run standalone -w @scrumwise/workspace-app`
(needs `npm install` on your machine and the backend running).

### Logs

Every service logs through one shared logger (winston, in `packages/common/logger.js`).

```bash
docker compose logs -f api-gateway chat-service      # follow one or more services
docker compose logs --since 10m | grep id=3f9a1c2b   # follow one request through every service
LOG_LEVEL=debug docker compose up        # also show every NATS event published and received
```

Each request is one line: method, path, status, how long it took, who asked, and a request id.
The gateway creates the id and passes it on, so the same id appears in every service the request
touched. It is also returned to the caller in the `x-request-id` header.

```
11:10:25.896 info [project-service] GET /projects 200 7ms user=6acc… id=ed277546
11:10:25.897 info [api-gateway] POST /api/graphql 200 13ms what=query spaces user=6acc… id=ed277546
11:10:25.919 warn [project-service] GET /issues/NOPE-1 404 5ms what=This issue does not exist. id=df429659
```

`info` is a normal request, `warn` a refused one (with the reason), `error` a bug (with the stack
trace). Request bodies, passwords and tokens are never logged. With `NODE_ENV=production` or
`LOG_FORMAT=json` the lines are JSON, for a log collector.

### Ports

| Port | What |
|------|------|
| 5170 | The app (web shell) |
| 5171–5173 | Micro-frontends |
| 8080 | API gateway. Swagger: http://localhost:8080/api/docs |
| 27018 | MongoDB, for tools such as Compass: `mongodb://localhost:27018` |
| 4223, 8223 | NATS and its monitoring page |

These were chosen to stay clear of a MongoDB on 27017 and a NATS on 4222 already running on this machine.

### If something goes wrong

- **A page says a part "could not be loaded":** that micro-frontend's container is not running. Check
  `docker compose ps` and its log.
- **"System limit for number of file watchers reached":** the compose file already avoids this for the
  frontends by checking files on a timer. If a service shows it, raise the limit:
  `sudo sysctl fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=512`.
- **After adding a package to a `package.json`:** run `docker compose up` again; it reinstalls first.

## Not built yet

This is the first working version, not the whole prototype. Still to do: Summary and Timeline tabs,
epics, the Development (GitHub) tab, global search, starred items, editing your profile, forgotten
password, attachments, sub-tasks, and automated tests. The setup is for development; a production
setup (built images, HTTPS, real secrets) is separate work.
