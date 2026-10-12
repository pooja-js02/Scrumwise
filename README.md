# Scrumwise

A Jira-style project tracker with built-in team chat.

The application is in [`Scrumwise/`](Scrumwise/): microservices (Node, Express, MongoDB, NATS, GraphQL) and micro-frontends (React, Redux, redux-saga). It runs with `docker compose up`. Start with its [README](Scrumwise/README.md).

What problem it solves, and how: [Problem statement](Docs/PROBLEM_STATEMENT.md).

## Run the application

```bash
cd Scrumwise
docker compose up
```

Then open http://localhost:5170 and log in with `maya.chen@atlas.example` / `demo1234`.
