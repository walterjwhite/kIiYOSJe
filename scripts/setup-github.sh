#!/usr/bin/env bash
#
# One-time GitHub repository setup: labels, security features, the `release`
# environment, and a branch ruleset for main. Idempotent where GitHub allows.
#
# Requires: gh (authenticated as a repo admin), node.
# Usage:    scripts/setup-github.sh [owner/repo]    (default: origin remote)
#           DRY_RUN=1 scripts/setup-github.sh        print the calls only
#
# This changes repository settings. Read it before running it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
OWNER="${REPO%%/*}"

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then printf 'DRY: %s\n' "$*"; else "$@"; fi
}

echo "==> Repository: $REPO"

echo "==> Labels"
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { parse } from "yaml";
  const labels = parse(readFileSync(process.argv[1], "utf8"));
  for (const l of labels) console.log([l.name, l.color, l.description].join("\t"));
' "$ROOT/.github/labels.yml" | while IFS=$'\t' read -r name color desc; do
  run gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" --force
done

echo "==> Security features (secret scanning, push protection, Dependabot alerts)"
run gh api -X PATCH "repos/$REPO" --input - <<'JSON'
{"security_and_analysis":{
  "secret_scanning":{"status":"enabled"},
  "secret_scanning_push_protection":{"status":"enabled"}}}
JSON
run gh api -X PUT "repos/$REPO/vulnerability-alerts"
run gh api -X PUT "repos/$REPO/automated-security-fixes"
run gh api -X PUT "repos/$REPO/private-vulnerability-reporting"

echo "==> Merge settings: squash only, delete merged branches"
run gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_auto_merge=true

echo "==> Actions: read-only default token, no auto-approval of PR reviews by Actions"
run gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

echo "==> Environment: release (you are the required reviewer)"
UID_NUM="$(gh api "users/$OWNER" -q .id)"
run gh api -X PUT "repos/$REPO/environments/release" --input - <<JSON
{"reviewers":[{"type":"User","id":$UID_NUM}],"deployment_branch_policy":null}
JSON

echo "==> Ruleset: main"
run gh api -X POST "repos/$REPO/rulesets" --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "ci-pass" },
          { "context": "agent-guard" },
          { "context": "CodeQL" },
          { "context": "Dependency review" }
        ] } }
  ]
}
JSON

echo "Done. Next: run scripts/seed-issues.sh to create the launch backlog."
