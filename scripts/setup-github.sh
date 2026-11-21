#!/usr/bin/env bash
#
# One-time GitHub repository setup: labels, security features, the `release`
# environment, and a branch ruleset for main. Idempotent where GitHub allows.
#
# Requires: gh (authenticated as a repo admin), node.
# Usage:    scripts/setup-github.sh [owner/repo]    (default: origin remote)
#           DRY_RUN=1 scripts/setup-github.sh        print the calls only
#           ALLOW_ADMIN_BYPASS=1 scripts/setup-github.sh   PAT fallback on a one-person repo: let
#                                                    admins merge PRs they authored
#
# This changes repository settings. Read it before running it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
OWNER="${REPO%%/*}"

WARNINGS=()
run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then printf 'DRY: %s\n' "$*"; else "$@"; fi
}
warn() {
  printf 'warning: %s\n' "$*" >&2
  WARNINGS+=("$*")
}

echo "==> Repository: $REPO"

echo "==> Preflight: admin permission"
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf 'DRY: gh api repos/%s -q .permissions.admin\n' "$REPO"
else
  ACTOR="$(gh api user -q .login)"
  ADMIN="$(gh api "repos/$REPO" -q '.permissions.admin // false')" || ADMIN=false
  if [[ "$ADMIN" != "true" ]]; then
    {
      echo "error: gh is authenticated as $ACTOR, which does not have admin permission on $REPO."
      echo
      echo "This script changes repository settings (labels, security features, merge policy,"
      echo "the release environment, and the main ruleset), so it must run as an admin of"
      echo "$OWNER. GitHub answers 404 instead of 403 for that, which is why the call above"
      echo "reports \"Not Found\". Nothing was changed."
      echo
      echo "Switch to an admin account (gh auth switch) or authenticate a token with admin"
      echo "access to $REPO, then re-run this script."
    } >&2
    exit 1
  fi
  echo "admin: $ACTOR"
fi

echo "==> Labels"
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { parse } from "yaml";
  const labels = parse(readFileSync(process.argv[1], "utf8"));
  let bad = 0;
  for (const l of labels) {
    // Quote-free colors such as 5319e7 parse as a YAML float; refuse anything
    // that is not six hex digits instead of sending an invalid color to GitHub.
    const color = String(l.color);
    if (!/^[0-9a-f]{6}$/i.test(color)) {
      console.error(`invalid color ${JSON.stringify(l.color)} for label ${l.name} (quote it in .github/labels.yml)`);
      bad = 1;
      continue;
    }
    console.log([l.name, color, l.description].join("\t"));
  }
  process.exitCode = bad;
' "$ROOT/.github/labels.yml" | while IFS=$'\t' read -r name color desc; do
  run gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" --force
done

echo "==> Security features (secret scanning, push protection, Dependabot alerts)"
# security_and_analysis is not writable through the API for every repository type
# (user-owned repositories expose it as null). Warn and continue instead of
# leaving the rest of the setup unapplied.
if ! run gh api -X PATCH "repos/$REPO" --input - <<'JSON'
{"security_and_analysis":{
  "secret_scanning":{"status":"enabled"},
  "secret_scanning_push_protection":{"status":"enabled"}}}
JSON
then
  warn "secret scanning / push protection not set via API; set them under Settings > Code security"
fi
run gh api -X PUT "repos/$REPO/vulnerability-alerts"
run gh api -X PUT "repos/$REPO/automated-security-fixes"
# Private vulnerability reporting is unavailable on some plans/repository
# visibilities, and GitHub answers 404 instead of explaining why.
if ! run gh api -X PUT "repos/$REPO/private-vulnerability-reporting"; then
  warn "private vulnerability reporting not enabled (needs a public repository or GitHub Advanced Security)"
fi

echo "==> Merge settings: squash only, delete merged branches"
run gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_auto_merge=true

echo "==> Actions: read-only default token, no auto-approval of PR reviews by Actions"
run gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

echo "==> Environment: release (you are the required reviewer)"
# users/<owner> only resolves for user-owned repositories; for an organization
# the reviewer is the account running the script.
if [[ "$(gh api "repos/$REPO" -q .owner.type)" == "Organization" ]]; then
  UID_NUM="$(gh api user -q .id)"
else
  UID_NUM="$(gh api "users/$OWNER" -q .id)"
fi
# Required reviewers on an environment is a paid-plan feature for private
# repositories; GitHub returns 422 and still creates the environment without
# protection, so this must be a visible warning, not a silent success.
if ! run gh api -X PUT "repos/$REPO/environments/release" --input - <<JSON
{"reviewers":[{"type":"User","id":$UID_NUM}],"deployment_branch_policy":null}
JSON
then
  warn "environment 'release' was created WITHOUT a required reviewer (that protection rule needs Pro/Team on a private repository): deploys to it are not gated"
fi

echo "==> Ruleset: default branch"
RULESET_METHOD=POST
RULESET_URL="repos/$REPO/rulesets"
if [[ "${DRY_RUN:-0}" != "1" ]]; then
  RULESET_ID="$(gh api "repos/$REPO/rulesets" -q '.[] | select(.name == "main protection") | .id' 2>/dev/null || true)"
  # A failed list call prints its error body to stdout; only a numeric id counts.
  if [[ "$RULESET_ID" =~ ^[0-9]+$ ]]; then
    RULESET_METHOD=PUT
    RULESET_URL="repos/$REPO/rulesets/$RULESET_ID"
    echo "updating existing ruleset $RULESET_ID"
  fi
fi

# Pull requests opened with a personal access token are authored by you, and the
# author cannot approve their own PR. On a one-maintainer repository, prefer the
# GitHub App identity (the PR is then authored by the app, and you can approve it).
# If you use the PAT fallback instead, ALLOW_ADMIN_BYPASS=1 lets repository admins
# merge through a pull request without the approval (checks still run, but an
# admin can merge past them).
BYPASS_JSON='[]'
if [[ "${ALLOW_ADMIN_BYPASS:-0}" == "1" ]]; then
  BYPASS_JSON='[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"pull_request"}]'
  warn "ruleset allows admin bypass through pull requests (ALLOW_ADMIN_BYPASS=1)"
fi
if ! run gh api -X "$RULESET_METHOD" "$RULESET_URL" --input - <<JSON
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": $BYPASS_JSON,
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
then
  warn "no branch ruleset applied: rulesets are unavailable for private repositories on a free plan (make the repository public or upgrade to Pro/Team), then re-run"
fi

if ((${#WARNINGS[@]})); then
  echo
  echo "Completed with warnings:"
  for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi

echo "Done. Next steps:"
echo "  1. gh secret set GEMINI_API_KEY --repo $REPO     # key from https://aistudio.google.com/apikey"
echo "  2. Create a GitHub App for the agent (see .kiro/steering/workflow.md), then:"
echo "       gh variable set APP_ID --repo $REPO --body <app id>"
echo "       gh secret set APP_PRIVATE_KEY --repo $REPO < private-key.pem"
echo "     or, as a fallback, gh secret set AGENT_GITHUB_TOKEN --repo $REPO"
echo "  3. scripts/seed-issues.sh to create the launch backlog."
