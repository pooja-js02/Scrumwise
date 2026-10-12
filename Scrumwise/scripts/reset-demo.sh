#!/bin/sh
# Empties the four Scrumwise databases and loads the demo data again. Containers keep running.
set -e
cd "$(dirname "$0")/.."
docker compose exec -T mongo mongosh --quiet --eval '
  for (const name of ["scrumwise_auth", "scrumwise_projects", "scrumwise_chat", "scrumwise_notifications"]) db.getSiblingDB(name).dropDatabase();
  print("databases emptied");'
docker compose run --rm seed
