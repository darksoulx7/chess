#!/usr/bin/env bash
# Starts native Postgres 16 + Redis 7 for local dev/tests when Docker is unavailable.
# Idempotent. Usage: scripts/dev-services.sh
set -euo pipefail

if ! pg_lsclusters 2>/dev/null | grep -q ' online '; then
  pg_ctlcluster 16 main start
  for _ in $(seq 1 20); do pg_isready -q && break; sleep 0.5; done
fi
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes --port 6379 >/dev/null
fi

su postgres -c "psql -tc \"select 1 from pg_roles where rolname='chess'\"" | grep -q 1 \
  || su postgres -c "psql -c \"create role chess login password 'chess' createdb\""
su postgres -c "psql -tc \"select 1 from pg_database where datname='chess'\"" | grep -q 1 \
  || su postgres -c "createdb -O chess chess"

PGPASSWORD=chess psql -h 127.0.0.1 -U chess -d chess -c 'select 1' >/dev/null
redis-cli ping
echo "postgres + redis ready"
