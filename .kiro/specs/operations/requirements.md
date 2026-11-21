# Requirements — operations

## Introduction

An operator installs `mind`, runs it for months on one machine, upgrades it, backs
it up, and eventually removes it. This spec covers those moments.

## Requirement 1 — Install and first run

1. WHEN the server first starts THEN it SHALL create the config directory (mode
   700), the token (mode 600), and the database, and SHALL print where they are.
2. WHEN Node is older than the required version THEN startup SHALL fail with a
   message naming the required version.
3. The README quickstart SHALL work from a clean checkout and SHALL be exercised
   by CI.
4. The server SHALL bind only to `127.0.0.1`.

## Requirement 2 — Configuration

1. Settings SHALL come from environment, then `credentials.yml`, then defaults.
2. Config and Directions SHALL hot-reload on mtime change. A broken edit SHALL
   keep the last good version and log the error once.
3. The model provider and its egress SHALL be visible in one place in config. The
   default SHALL be local Ollama.
4. Startup SHALL refuse a token or credentials file readable by group or others
   (POSIX), with the fix in the message.

## Requirement 3 — Upgrade

1. Before applying pending migrations the server SHALL back up the database.
2. The server SHALL refuse to start on a schema newer than it supports.
3. Migrations SHALL be forward-only and idempotent; re-running is a no-op.
4. A release SHALL ship an upgrade note when config or the API changes.

## Requirement 4 — Backup and restore

1. `mind backup` SHALL write a consistent copy using SQLite's backup API, mode 600.
2. `mind restore <file>` SHALL validate the schema version, take a safety copy of
   the current database, and then replace it.
3. A test SHALL restore a backup and compare row counts.

## Requirement 5 — Retention, export, purge

1. Retention SHALL delete signals and derived content older than
   `MIND_RETENTION_DAYS` in batches, then checkpoint the WAL.
2. `mind export` SHALL write a JSON bundle without credentials.
3. `mind purge --yes` SHALL delete the database, status file, and caches. Config
   stays unless `--all`.

## Requirement 6 — Health and diagnostics

1. `/health` SHALL report process, database, and per-adapter state.
2. `mind doctor` SHALL check Node version, file modes, database integrity
   (`PRAGMA integrity_check`), pending migrations, model reachability, and
   adapter configuration, and print fixes. It SHALL NOT print secrets.

## Requirement 7 — Shutdown and crash safety

1. On SIGINT or SIGTERM the server SHALL stop adapters, finish or abandon
   in-flight work safely, checkpoint the WAL, and exit 0.
2. A crash SHALL leave the database consistent; sends are covered by the
   idempotency requirements in safety-send-gating.

## Requirement 8 — Uninstall

1. Docs SHALL list every path the product writes, and how to remove it and to
   revoke provider access.
