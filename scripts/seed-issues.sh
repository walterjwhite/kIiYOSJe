#!/usr/bin/env bash
#
# Creates the launch-readiness backlog as GitHub Issues. Skips any issue whose
# title already exists (open or closed). Seeded issues do NOT carry `ai-ready`:
# a maintainer reviews each one and adds the label when it is clear enough.
#
# Requires: gh (authenticated), labels from scripts/setup-github.sh.
# Usage:    scripts/seed-issues.sh [owner/repo]
#           DRY_RUN=1 scripts/seed-issues.sh

set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

# issue "<title>" "<labels,comma>" "<problem>" "<scope>" "<criterion 1|criterion 2|...>"
issue() {
  local title="$1" labels="$2" problem="$3" scope="$4" criteria="$5" body
  if [[ "${DRY_RUN:-0}" != "1" ]] && gh issue list --repo "$REPO" --state all --search "in:title \"$title\"" --json title -q '.[].title' | grep -Fxq "$title"; then
    echo "skip (exists): $title"; return
  fi
  body="### Problem and why it matters"$'\n\n'"$problem"$'\n\n'"### Scope"$'\n\n'"$scope"$'\n\n'"### Acceptance criteria"$'\n\n'
  local IFS='|' c
  for c in $criteria; do body+="- [ ] ${c}"$'\n'; done
  body+="- [ ] \`npm run lint\`, \`npm test\`, \`npm run license:check\` pass"$'\n'
  if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "DRY: $title [$labels]"; return; fi
  printf '%s' "$body" | gh issue create --repo "$REPO" --title "$title" --label "$labels" --body-file - >/dev/null
  echo "created: $title"
}

# ---- Security -------------------------------------------------------------
issue "Compare the API token in constant time" "security,safety-gate,launch-blocker" \
  "packages/server/src/auth.ts compares the bearer token with !==, which leaks timing." \
  "In: packages/server/src/auth.ts and its test. Out: token format or storage." \
  "Token comparison uses crypto.timingSafeEqual on equal-length buffers|A wrong-length token is rejected without throwing|Test covers missing, short, long, and wrong tokens"

issue "Reject requests with an unexpected Host or Origin header" "security,safety-gate,launch-blocker" \
  "The API binds to 127.0.0.1 but a web page can still reach it through DNS rebinding or a cross-site request. Nothing checks Host or Origin today." \
  "In: packages/server/src/app.ts (new middleware) and tests. Out: adding CORS support." \
  "Requests whose Host is not 127.0.0.1:8787 or localhost:8787 get 403 before auth runs|Requests with a browser Origin header that is not a vscode-webview origin get 403|No Access-Control-Allow-* headers are ever sent|Tests cover rebinding host, foreign Origin, and CLI requests with no Origin"

issue "Honor MIND_TEST_TOKEN only under test" "security,safety-gate,launch-blocker" \
  "auth.ts lets the MIND_TEST_TOKEN environment variable replace the real token in any process." \
  "In: packages/server/src/auth.ts. Out: changing how tests set the token." \
  "The override applies only when NODE_ENV is test or VITEST is set|A production start with MIND_TEST_TOKEN set logs a warning and ignores it|Test proves the override is ignored outside test mode"

issue "Refuse to start when the token or credentials file is group or world readable" "security,launch-blocker" \
  "tech.md requires mode 600 for config and credentials but nothing verifies it after creation." \
  "In: packages/core (config, credentials), packages/server startup. Windows: skip with a logged note." \
  "Startup fails with a clear message when token or credentials.yml has group/other bits|The message gives the chmod command|Tests cover 600, 640, and 644"

issue "Add a prompt-injection regression corpus" "security,ai-quality,launch-blocker" \
  "Bodies are treated as data, but there is no corpus proving that hostile text cannot change posture, Direction, or trigger a send." \
  "In: packages/pipeline tests and fixtures. Uses a stub model that obeys the injected text, so the guard is what is tested." \
  "At least 20 hostile fixtures (ignore previous instructions, fake system tags, send-now requests, hidden text, quoted threads)|No fixture can produce autonomy=send or change the matched Direction|Fixtures contain no real personal data"

issue "Test that the webview CSP is strict and has no remote resources" "security" \
  "structure.md requires a nonce CSP and no remote resources, but no test enforces it." \
  "In: extension/test." \
  "Every webview HTML string includes a nonce-based CSP with default-src 'none'|No http(s) URL appears in generated HTML|Test fails if a new webview omits the CSP"

# ---- Safety ---------------------------------------------------------------
issue "Prove each send gate blocks a send on its own" "safety-gate,launch-blocker" \
  "The product promise is that any one gate stops a send. Tests exist for gates together but not as a one-gate-off matrix." \
  "In: packages/pipeline/src/decide.test.ts and autosend.test.ts. Do not change decide.ts behavior." \
  "Matrix test: all gates open sends; closing exactly one of adapter capability, autonomy, MIND_SEND_ENABLED, pause flag, or non-empty draft blocks it|Gates are re-checked at send time, not only at decide time|Each blocked case records an action explaining which gate stopped it"

issue "Make sends idempotent and recoverable after a crash" "safety-gate,launch-blocker" \
  "A crash between provider send and database write could send twice on retry." \
  "In: packages/pipeline autosend and adapters send contract. Needs a design note in .kiro/specs/safety-send-gating before code." \
  "A send intent is recorded before the provider call with an idempotency key|On restart, intents without a result are reconciled and never resent blindly|Test simulates a crash after the provider call"

issue "Demo data can never reach a real adapter" "safety-gate" \
  "Seeded personas replay through the real pipeline. A misconfigured demo must not send or read from live accounts." \
  "In: packages/demo-data and server startup." \
  "demo:serve forces all adapters to observe and send disabled|Test fails if a real adapter is registered while the demo database is in use"

# ---- Performance ----------------------------------------------------------
issue "Verify and set SQLite pragmas and indexes" "performance,launch-blocker" \
  "Defaults are slow and unsafe for a long-lived process with concurrent reads from the extension." \
  "In: packages/core/src/db. Any index goes in a new migration." \
  "WAL, foreign_keys=ON, busy_timeout, and synchronous=NORMAL are set at open|EXPLAIN QUERY PLAN for Queue, Thoughts, Signals, and metrics queries shows no full scans at 100k signals|Missing indexes added in a new migration|PRAGMA optimize runs on close and daily"

issue "Add an ingest and query benchmark with budgets" "performance" \
  "No numbers exist for latency, memory, or database size." \
  "In: scripts/bench.mjs (no new dependency). Uses a stub model." \
  "Benchmark ingests 10k synthetic signals and reports p50/p95 per stage, RSS, and DB size|Budgets documented in .kiro/steering/performance.md|CI job runs a smaller run and fails on a 2x regression"

issue "Bound model calls: concurrency, timeout, retry, circuit breaker" "performance,ai-quality,launch-blocker" \
  "A slow or down provider can stall ingest or pile up requests." \
  "In: packages/pipeline model layer and ACP transport." \
  "Concurrency cap configurable, default 2|Per-call timeout and exponential backoff with jitter, max 3 tries|After repeated failures the circuit opens and signals are recorded as 'classification deferred' and retried later|Provider outage produces no send and no lost signal"

issue "Add a daily token and cost cap for cloud providers" "performance,privacy" \
  "Ollama is free; OpenAI, Anthropic, and Google are not. A replay or loop could spend without bound." \
  "In: packages/pipeline model layer, config." \
  "Config sets a daily token ceiling per provider|Usage is recorded per call (counts only, no content)|At the ceiling, new signals are deferred and the Queue shows why"

# ---- Observability and privacy -------------------------------------------
issue "Add a correlation id to every log line for a signal" "docs,performance" \
  "Debugging one signal across stages requires grepping by hand." \
  "In: packages/core logger, packages/pipeline ingest." \
  "Each signal gets a correlationId carried through dedupe, match, classify, decide, record|Log lines include it; message bodies still never appear|Test asserts the field and the absence of body text"

issue "Expose the weekly signals-to-thoughts ratio" "ai-quality,launch-blocker" \
  "The product metric is signals per week divided by thoughts per week, and it must be visible." \
  "In: packages/server/src/routes/metrics.ts, CLI, extension status. Verify what /metrics returns first." \
  "GET /metrics returns signals, thoughts, and ratio for a weekly window and a trailing 4-week series|Ratio handles zero thoughts without dividing by zero|The CLI prints it|No badge or counter is added to the extension UI"

issue "Add purge and export commands" "privacy,launch-blocker" \
  "An operator must be able to delete everything and take their data with them." \
  "In: packages/cli, packages/server admin routes, docs/data inventory." \
  "mind export writes a JSON bundle without credentials|mind purge --yes deletes the database, the status file, and cached state, and keeps config unless --all|Both require the token and are logged as events without content"

issue "Verify backup and add restore" "privacy,launch-blocker" \
  "packages/pipeline/src/backup.ts exists. A backup that has never been restored is not a backup." \
  "In: packages/pipeline backup, CLI." \
  "mind restore <file> validates schema version, then replaces the database after taking a safety copy|Test backs up a populated database, restores it, and compares row counts|Restore refuses a newer schema than the binary supports"

# ---- AI quality -----------------------------------------------------------
issue "Build a labelled evaluation set and harness" "ai-quality,launch-blocker" \
  "The thesis depends on the classifier surfacing the right things. There is no measurement beyond the demo personas." \
  "In: packages/pipeline/eval (fixtures plus runner). Synthetic data only." \
  "At least 100 labelled signals with expected posture and whether a human is needed|Runner reports surface precision, surface recall, and false-absorb rate per model|A stub-model run executes in CI; a live-model run is a documented manual command|Thresholds recorded in .kiro/steering/ai-quality.md"

issue "Record prompt and model version on every action" "ai-quality" \
  "Without it, a change in behavior cannot be traced to a prompt or model change." \
  "In: packages/pipeline, a new migration for the column." \
  "Each actions row stores promptVersion and model id|Prompt text lives in versioned constants|Test asserts both are written"

# ---- Tooling and CI -------------------------------------------------------
issue "Add ESLint and Prettier with a license-checked dependency set" "ci,docs" \
  "npm run lint only typechecks. Style and common bugs are unchecked." \
  "Adds devDependencies (needs deps-approved). Includes .editorconfig alignment." \
  "ESLint with typescript-eslint, no-floating-promises, no-explicit-any|Prettier config committed|npm run lint runs tsc and eslint; npm run format:check exists|CI runs both|license:check passes"

issue "Add test coverage reporting with a floor" "ci" \
  "No coverage data exists." \
  "Adds @vitest/coverage-v8 as a devDependency (needs deps-approved)." \
  "npm run test:coverage prints per-package coverage|CI fails below a floor set at the current value minus 2 points|Pipeline decide and auth have 100% branch coverage"

issue "Pin GitHub Actions to commit SHAs" "ci,security" \
  "Workflows use version tags, which a compromised action repository can move." \
  "In: .github/workflows. Dependabot keeps the pins fresh." \
  "Every uses: line references a full commit SHA with a version comment|Dependabot opens PRs for updates"

issue "Run CI on macOS and Windows" "ci" \
  "Supported platforms are undocumented and untested. The mode-600 rule has no meaning on Windows." \
  "In: .github/workflows/ci.yml matrix, docs." \
  "Matrix runs verify on ubuntu, macos, and windows|Platform differences are documented in README|Failures are fixed or the platform is declared unsupported"

issue "Add a migration upgrade test" "launch-blocker" \
  "Operators upgrade with real data. Only empty-database application is tested." \
  "In: packages/core tests." \
  "Applying 0000..N on an empty database works|A database at each historical version with sample rows upgrades to latest without data loss|Re-running migrate is a no-op"

# ---- Docs, product, release ----------------------------------------------
issue "Cut release v0.1.0" "launch-blocker,docs" \
  "No release process has been exercised." \
  "In: CHANGELOG.md, package versions, release workflow." \
  "CHANGELOG has a 0.1.0 entry|Both package.json versions are 0.1.0|Release workflow produces a draft release with the server archive, VSIX, SBOM, checksums, and provenance|Install from the VSIX on a clean machine works"

issue "Collapse status documents into one source of truth" "docs" \
  "STATUS.md, PLAN.md, TODO.md, todo/, and LIVE.md overlap and drift." \
  "In: root docs. Keep README as entry point; keep Kiro specs authoritative for requirements." \
  "One document owns status; others link to it or are removed|Test counts and file counts are not hard-coded in prose|Links are valid"

issue "Fix drift in tech.md and the test hook description" "docs" \
  "tech.md references sh build-server.sh at the root (it lives in scripts/), and the test hook says '27-file suite' while docs cite other counts." \
  "In: .kiro/steering/tech.md, .kiro/hooks/test-on-test-edit.kiro.hook, .kiro/steering/competition.md." \
  "Paths and counts are correct or no longer stated"

issue "Complete DISCLOSURES.md with file paths" "docs,needs-human-decision,launch-blocker" \
  "The submission must disclose pre-existing, generated, and borrowed code with paths and state which APIs are used." \
  "In: DISCLOSURES.md. Needs the author's knowledge of what was pre-existing." \
  "Every pre-existing, AI-generated, and borrowed file or directory is listed with its source|Official APIs used are named with scopes|No claim of provider verification or partnership"

issue "Decide whether the schema needs an owner column for multi-user" "needs-human-decision" \
  "DIRECTION.md section 2.1 plans multi-user. Adding ownership later is a migration over real data." \
  "Decision record in .kiro/specs or docs/adr. No code until decided." \
  "Decision recorded with alternatives and consequences|If yes, a migration issue is opened"

issue "Verify each adapter against a live account" "launch-blocker,needs-human-decision" \
  "STATUS.md says Gmail, Outlook, and Calendar are implemented but unverified." \
  "Manual with the operator's own credentials, in observe mode first." \
  "Per adapter: ingest a day of traffic, no duplicates after restart, scopes match docs|Findings recorded in STATUS|Revoking the token returns the adapter to 'not configured'"

issue "Accessibility pass on webviews and tree views" "docs" \
  "Keyboard, contrast, and screen-reader support are unchecked." \
  "In: extension." \
  "Every action is reachable by keyboard with a visible focus|Colors use VS Code theme tokens and meet contrast in light, dark, and high contrast|Interactive elements have accessible names"

echo "Done."
