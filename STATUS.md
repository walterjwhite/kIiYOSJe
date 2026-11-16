# mind — implementation status

Last updated: 2026-11-16. Measured against [PLAN.md](PLAN.md).

**Build:** all packages compile under TypeScript 7 strict. **Tests:** 63 passing across 15 files.
**Nothing has been run against a real LLM, a real Teams or email source, or inside VS Code.**
Every behaviour below marked "tested" was tested with in-memory SQLite, mocks, or curl against a local server.

## Phase status

| Phase | Status | Done-when criterion | Met? |
| ----- | ------ | ------------------- | ---- |
| P0 Skeleton | Complete | server serves `/health`, migration idempotent, tests pass | Yes. `/health` verified through `npm start` (same `dist/main.js` that `npm run dev` runs, minus `--watch`). The sandbox blocked running `npm run dev` itself. |
| P1 Teams ingest | Blocked by decision | a day of traffic stored, no duplicates on restart, count matches client | No. Adapter is a stub by request. Dedupe, persistence and `/metrics` work via `POST /signals`. |
| P2 Directions + draft absorb | Code complete, unvalidated | ≥60% match a Direction, drafts match what I'd write, discards recorded | Not measurable. Needs an API key and real traffic. Discards are recorded (tested). |
| P3 Email | Not started | drafts in Drafts folder, Message-ID dedupe | No. Stub by request. |
| P4 Autonomy | Code complete, no end-to-end path | send only for `autonomy: send`, `mind pause` stops all sends, sends reconstructible from `events` | Partly. Gates and pause are tested with a fake adapter. No real adapter can send. |
| P5 Learning loop | Code complete | first proposal generated from real override data | No. Logic tested on synthetic data. No real override history exists. |
| P6 Mobile, FTS5 | Deferred | n/a | n/a |

## Implemented and tested

- **Core:** five-table Drizzle schema, two migrations, config, pino logger, zod schemas, status file (`~/.local/share/mind/status.json`, atomic, mode 600).
- **Pipeline:** dedupe, normalize (quote stripping), match (person > thread > project > topic > catch-all), classify, draft, decide, record.
- **Catch-all direction** (`system/catch-all`): lets the system answer or acknowledge signals no authored Direction covers. Explicit Directions always win.
- **Escalation deadlines:** `escalateBy` from the classifier's explicit deadline, else urgency (high 2h, medium 24h, low 72h; low-urgency acknowledgements and information get none). A 60s checker promotes overdue seedling Thoughts to `active` and writes an audit event.
- **Send gates (§7):** adapter capability, `autonomy: send`, `MIND_SEND_ENABLED=true`, no triggered guard, and no pause flag. Autonomous send is re-checked at send time. An empty draft is never auto-sent.
- **Kill switch:** `mind pause` / `mind resume` and `POST /admin/pause|resume` create or remove `~/.config/mind/paused`. It takes effect immediately and also blocks human-approved sends (HTTP 423).
- **Guards:** `escalateOn` topics and `maxPerThreadPerHour`.
- **Auto-disable:** a Direction is disabled when its override rate exceeds 20% with at least 5 decided actions.
- **Retention:** signal bodies redacted after 30 days (configurable). **Backup:** startup and daily `.backup()`, 14 files kept.
- **Learning loop:** proposes narrowing, widening, or a new Direction. Proposals are events. `GET /proposals`, `POST /proposals/run|:id/accept|:id/reject`. Accepting updates the DB row and returns the YAML edit you must make by hand, because YAML is the source of truth and a reload would revert a DB-only change.
- **API:** all routes in PLAN §9, plus `/admin/*`, `/proposals/*`, `PATCH /actions/:id` (edit a draft before approving). `/metrics` returns all six planned metrics plus a per-Direction breakdown. `/directions` includes match stats.

## Not verified

- **LLM paths** (`classify`, `draft`) have only run in their no-key fallback. Prompts, the `generateObject` call shape, and the default model names (`gpt-4o-mini`, `claude-haiku-4-5`, etc.) are unconfirmed. Check the model names against your provider before first use.
- **VS Code extension** compiles but has never been loaded in VS Code. The thought-open, approve/discard menus, brief refresh button and pause/resume commands are untested.
- **`/send` for human approval** is tested only up to the pause check. No adapter implements `send`, so a successful human send has never run.

## Gaps against PLAN.md

1. **Adapter contract test suite (§5)** does not exist.
2. **Normalize (§8.2):** signature stripping, participant resolution, and deadline/commitment extraction are not implemented. Commitments come only from the classifier.
3. **`filed` disposition (§8.3)** is never produced. The catch-all replaced "no match → escalated or filed", so nothing is silently filed. Decide whether you want a quiet "file" path for mail not addressed to you.
4. **`escalate` posture** creates a Thought but does not pin it to the brief.
5. **Thoughts tree** is a flat sort. PLAN §10 asks for grouping by Direction.
6. **Learning-loop UI:** proposals are API-only. The extension shows no diff view.
7. **`mind observe`** prints metrics. PLAN §14 describes it as a mode switch. No global observe mode exists. The per-Direction `autonomy: observe` does.
8. **P2 "≥60% match"** is meaningless now that the catch-all matches everything. Measure it on explicit Directions only (`byDirection` excluding `system/catch-all`).
9. **Override tracking:** `sendsWithoutRevert` counts sent actions only. Reverts are not tracked.
10. **Dependencies:** `npm audit` reports 4 moderate vulnerabilities, not reviewed. `skipLibCheck: true` is set because `drizzle-orm@0.45.4` declarations fail under TypeScript 7 (PLAN §11).
11. **Git:** nothing is committed.

## Open decisions (PLAN §17)

1. **Model provider:** the code defaults to OpenAI. Set `MIND_AI_PROVIDER` and put the key in `~/.config/mind/ai.json` (see `config.ts`). Not yet chosen.
2. **Teams transport:** stubbed.
3. **Email write capability:** stubbed.
4. **Remote authentication:** deferred to P6.
