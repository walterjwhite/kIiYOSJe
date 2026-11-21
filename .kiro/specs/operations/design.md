# Design — operations

## Paths

| Purpose                    | Default                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| Config, token, credentials | `~/.config/kIiYOSJe/mind/` (override `MIND_CONFIG_DIR`)             |
| Database and status        | `~/.data/kIiYOSJe/mind/` (override `MIND_DATA_DIR`, `MIND_DB_PATH`) |
| Directions                 | `directions/` in the repo or `MIND_DIRECTIONS_DIR`                  |
| Backups                    | operator-chosen path; default `<data>/backups/`                     |

## Startup sequence

1. Check Node version and file modes.
2. Open the database, run `PRAGMA integrity_check` only on `mind doctor`.
3. If migrations are pending: back up, apply, log versions.
4. If the schema is newer than known: exit with a clear message.
5. Start adapters (each isolated), then listen on `127.0.0.1:8787`.

## Backup

Use `better-sqlite3`'s `db.backup()` so the copy is consistent while the server
runs. Write to a temp file with mode 600, then rename.

## Doctor output

One line per check: `ok`, `warn`, or `fail` with the fix. Exit non-zero on any
`fail`. Output is safe to paste into an issue.

## Windows and macOS

POSIX mode checks do not apply on Windows; the check logs a note and relies on
the per-user profile ACL. Supported platforms are stated in the README after CI
runs on them.
