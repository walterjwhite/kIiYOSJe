#!/bin/sh
# Mint a Google OAuth refresh token for one mailbox, using the OAuth client
# already configured in credentials.yml.
#
#   scripts/google-refresh-token.sh --account me@gmail.com
#
# The client id/secret are read from the `google:` section, so they only need to
# be passed (or exported) when setting up a fresh machine:
#
#   MIND_GOOGLE_CLIENT_ID=... MIND_GOOGLE_CLIENT_SECRET=... \
#     scripts/google-refresh-token.sh --account me@gmail.com --label personal
#
# Google returns a refresh token only for `access_type=offline` plus a real
# consent prompt, so the URL always carries both. The token is then exchanged
# for an access token and checked against the Gmail profile, which is what
# catches "I was still signed into the other account" — a mistake that surfaces
# weeks later as one mailbox silently reading another's mail.
#
# Options:
#   --account EMAIL        Mailbox to authorise (passed as login_hint)
#   --label NAME           Account label; defaults to the address' local part
#   --port N               Loopback port (default 8765)
#   --credentials PATH     Default ~/.config/kIiYOSJe/mind/credentials.yml
#   --client-id / --client-secret
#   --token VALUE          Skip the browser flow; verify an existing refresh token
#   --write                Write the token into credentials.yml (backs it up first)
#   --url-only             Print the consent URL and exit (no listener)
#   -h, --help
#
# Run it once per mailbox. The first token fills `google.refreshToken` (the
# default account); later ones append to `google.accounts`, because that list is
# additive — adding a mailbox never moves the token you already had.

set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CREDENTIALS=${MIND_CREDENTIALS:-$HOME/.config/kIiYOSJe/mind/credentials.yml}
PORT=8765
ACCOUNT=""
LABEL=""
CID=${MIND_GOOGLE_CLIENT_ID:-}
SEC=${MIND_GOOGLE_CLIENT_SECRET:-}
TOKEN=${MIND_GOOGLE_REFRESH_TOKEN:-}
WRITE=0
URL_ONLY=0

usage() { sed -n '2,41p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case $1 in
    --account) ACCOUNT=${2:?--account needs an email}; shift 2 ;;
    --label) LABEL=${2:?--label needs a name}; shift 2 ;;
    --port) PORT=${2:?--port needs a number}; shift 2 ;;
    --credentials) CREDENTIALS=${2:?--credentials needs a path}; shift 2 ;;
    --client-id) CID=${2:?--client-id needs a value}; shift 2 ;;
    --client-secret) SEC=${2:?--client-secret needs a value}; shift 2 ;;
    --token) TOKEN=${2:?--token needs a refresh token}; shift 2 ;;
    --write) WRITE=1; shift ;;
    --url-only) URL_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [ ! -f "$CREDENTIALS" ]; then
  echo "no credentials file at $CREDENTIALS" >&2
  exit 1
fi

if [ "$WRITE" = 1 ]; then
  BACKUP=$CREDENTIALS.bak-$(date +%Y%m%d%H%M%S)
  cp -p "$CREDENTIALS" "$BACKUP"
  echo "backup    $BACKUP"
fi

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT INT TERM

cat >"$TMP" <<'NODE'
const http = require("node:http");
const fs = require("node:fs");
const { createRequire } = require("node:module");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
];
const REDIRECT = `http://127.0.0.1:${process.env.PORT_}`;
const PATH = process.env.CREDENTIALS;
const WANT = process.env.ACCOUNT;
const WANT_LABEL = process.env.LABEL;
const SUPPLIED_TOKEN = process.env.TOKEN_;
const WRITE = process.env.WRITE === "1";
const URL_ONLY = process.env.URL_ONLY === "1";

let YAML = null;
try {
  YAML = createRequire(`${process.env.REPO_DIR}/package.json`)("yaml");
} catch {
  /* snippet-only mode; --write falls back to printing */
}

function fail(msg, hint) {
  console.error(`\n[error] ${msg}`);
  if (hint) console.error(`        ${hint}`);
  process.exit(1);
}

function readConfig() {
  if (!YAML) return { text: null, doc: null };
  const text = fs.readFileSync(PATH, "utf8");
  const doc = YAML.parse(text) ?? {};
  return { text, doc };
}

const { doc } = readConfig();
const google = doc?.google ?? {};

const clientId = process.env.CID || google.clientId;
const clientSecret = process.env.SEC || google.clientSecret;
if (!clientId || !clientSecret) {
  fail(
    "no Google OAuth client configured.",
    "Set google.clientId/clientSecret in credentials.yml, or pass --client-id/--client-secret.",
  );
}

const consentUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    ...(WANT ? { login_hint: WANT } : {}),
  });

if (URL_ONLY) {
  console.log(consentUrl);
  process.exit(0);
}

async function tokenRequest(form) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...form,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function tokenExchange(code) {
  const { ok, status, body } = await tokenRequest({
    code,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
  });
  if (!ok || !body.access_token) {
    const err = body.error ?? `http ${status}`;
    const hint =
      err === "invalid_grant"
        ? "The code was reused or expired — start over with a fresh URL."
        : err === "redirect_uri_mismatch"
          ? `This is not a Desktop-app client. Add ${REDIRECT} as an authorised redirect URI, or create the client as type "Desktop app".`
          : err === "invalid_client"
            ? "Google rejected the client id/secret pair."
            : err === "access_denied"
              ? "The account is not added as a test user on the OAuth consent screen."
              : undefined;
    fail(
      `token exchange failed: ${err}${body.error_description ? ` — ${body.error_description}` : ""}`,
      hint,
    );
  }
  return body;
}

async function api(url, token) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, body: await response.json() };
}

/** Which mailbox is behind this access token, and does Calendar answer? */
async function verify(accessToken) {
  const profile = await api(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    accessToken,
  );
  const calendars = await api(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
    accessToken,
  );
  return {
    email: profile.ok ? profile.body.emailAddress : undefined,
    mailOk: profile.ok,
    mailStatus: profile.status,
    calendars,
  };
}

function report(result) {
  console.log("");
  if (!result.mailOk) {
    console.log(`! gmail profile check failed (http ${result.mailStatus}) — scope may not be granted`);
  } else {
    console.log(`ok gmail        ${result.email}`);
  }
  if (result.calendars.ok) {
    const items = result.calendars.body.items ?? [];
    const primary = items.find((c) => c.primary)?.id ?? "(none)";
    console.log(`ok calendar     ${items.length} calendars, primary ${primary}`);
  } else {
    console.log(`! calendar check failed (http ${result.calendars.status})`);
  }
}

function snippet(email, label, refreshToken) {
  if (!google.refreshToken && !(google.accounts ?? []).length) {
    return [
      "Paste into the `google:` section of credentials.yml:",
      "",
      `  refreshToken: "${refreshToken}"`,
      `  address: ${email}`,
      `  label: ${label}`,
    ].join("\n");
  }
  return [
    "Append to `google.accounts` in credentials.yml:",
    "",
    "  accounts:",
    `    - label: ${label}`,
    `      address: ${email}`,
    `      refreshToken: "${refreshToken}"`,
  ].join("\n");
}

function persist(email, label, refreshToken) {
  if (!YAML) return false;
  const { doc: fresh } = readConfig();
  const section = fresh.google ?? (fresh.google = {});
  if (!section.clientId) section.clientId = clientId;
  if (!section.clientSecret) section.clientSecret = clientSecret;

  const list = Array.isArray(section.accounts) ? section.accounts : [];
  if (!section.refreshToken && list.length === 0) {
    section.refreshToken = refreshToken;
    section.address = email;
    section.label = label;
  } else {
    const existing = list.findIndex(
      (entry) =>
        entry &&
        entry.address &&
        String(entry.address).toLowerCase() === email.toLowerCase(),
    );
    const entry = { label, address: email, refreshToken };
    if (existing >= 0) list[existing] = { ...list[existing], ...entry };
    else list.push(entry);
    section.accounts = list;
  }

  fs.writeFileSync(PATH, YAML.stringify(fresh), { mode: 0o600 });
  fs.chmodSync(PATH, 0o600);
  return true;
}

function finish(result, refreshToken) {
  const email = result?.email ?? WANT ?? "";
  const label =
    WANT_LABEL ||
    (email ? email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "-") : "default");
  const mismatched =
    Boolean(WANT && email) && email.toLowerCase() !== WANT.toLowerCase();
  if (mismatched) {
    console.log(`! authorised as ${email}, not ${WANT} — the browser kept the other session.`);
    console.log("  Do not save this token; sign out of Google (or use a private window) and retry.");
  }

  if (WRITE && !mismatched) {
    if (persist(email, label, refreshToken)) {
      console.log(`\nwrote ${label} (${email}) to ${PATH}`);
      console.log("mind re-reads credentials.yml on mtime change; no restart needed.");
      return;
    }
    console.log("\n! `yaml` module not found — falling back to a paste-able snippet.");
  }

  console.log(`\n${snippet(email, label, refreshToken)}`);
}

async function main() {
  if (SUPPLIED_TOKEN) {
    console.log(`using supplied refresh token for ${WANT ?? "(account unknown until verified)"}`);
    const { ok, body } = await tokenRequest({
      refresh_token: SUPPLIED_TOKEN,
      grant_type: "refresh_token",
    });
    if (!ok || !body.access_token) {
      fail(
        `could not verify the supplied token: ${body.error ?? "unknown error"}`,
        "It may be expired or revoked; re-run without --token to authorise again.",
      );
    }
    const result = await verify(body.access_token);
    report(result);
    finish(result, SUPPLIED_TOKEN);
    return;
  }

  console.log(`client    ${clientId.slice(0, 12)}…`);
  console.log(`account   ${WANT ?? "(no login_hint — pick any in the browser)"}`);
  console.log(`scopes    gmail.modify, calendar`);
  console.log(`\nOpen this URL, choose the right mailbox, approve:\n\n${consentUrl}\n`);
  console.log(`Waiting for the redirect on ${REDIRECT} (ctrl-c to abort)…`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT);
      const got = url.searchParams.get("code");
      const denied = url.searchParams.get("error");
      if (denied) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(`Authorization failed: ${denied} — you can close this tab.`);
        server.close();
        reject(new Error(`authorization was denied (${denied})`));
        return;
      }
      if (!got) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("Waiting for the authorization code…");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Authorised — you can close this tab and return to the terminal.");
      server.close();
      resolve(got);
    });
    server.on("error", (err) =>
      reject(
        new Error(
          err.code === "EADDRINUSE"
            ? `port ${process.env.PORT_} is already in use — pass --port`
            : err.message,
        ),
      ),
    );
    server.listen(Number(process.env.PORT_), "127.0.0.1");
  }).catch((err) => fail(err.message));

  const tokens = await tokenExchange(code);
  if (!tokens.refresh_token) {
    fail(
      "Google returned an access token but no refresh token.",
      "Revoke the app at https://myaccount.google.com/permissions and run again; consent is only re-issued once.",
    );
  }

  const result = await verify(tokens.access_token);
  report(result);
  finish(result, tokens.refresh_token);
}

main().catch((err) => fail(err.message));
NODE

REPO_DIR=$REPO_DIR CREDENTIALS=$CREDENTIALS PORT_=$PORT ACCOUNT=$ACCOUNT \
  LABEL=$LABEL CID=$CID SEC=$SEC TOKEN_=$TOKEN WRITE=$WRITE URL_ONLY=$URL_ONLY \
  node "$TMP"
