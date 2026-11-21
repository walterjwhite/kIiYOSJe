# Requirements — local server API

## Introduction

The server is the single source of truth. The VS Code extension and the CLI are
clients. This spec states the API contract and its security properties.

## Requirement 1 — Authentication on every route

1. Every route, including `/health`, SHALL require `Authorization: Bearer <token>`.
2. The token comparison SHALL be constant time.
3. A missing or wrong token SHALL return 401 with no detail, and SHALL be logged
   without the supplied value.

## Requirement 2 — Local-only exposure

1. The server SHALL bind to `127.0.0.1` only.
2. A request whose `Host` header is not an allowed loopback name and port SHALL
   get 403 before any other processing.
3. A request carrying an `Origin` header that is not an allowed webview origin
   SHALL get 403.
4. The server SHALL NOT send `Access-Control-Allow-*` headers.

## Requirement 3 — Validation and limits

1. Every request body, query, and parameter SHALL be validated with zod; invalid
   input SHALL return 400 with field-level errors and no echo of secrets.
2. Request bodies SHALL be size limited (the existing `bodyLimit`).
3. List endpoints SHALL paginate with a maximum page size.

## Requirement 4 — Errors

1. Errors SHALL use one JSON shape: `{ error, code, details? }`.
2. Responses SHALL NOT include stack traces, SQL, file paths, or message content.

## Requirement 5 — Contract and compatibility

1. The API SHALL be described by an OpenAPI document generated from or checked
   against the zod schemas.
2. A test SHALL fail when a route changes shape without the document changing.
3. The server SHALL expose its version and API version in `/health`.
4. WHEN the extension or CLI is older or newer than the server THEN it SHALL show
   a clear compatibility message rather than failing obscurely.

## Requirement 6 — Observability

1. Each request SHALL log method, route pattern, status, and duration, never the
   query string or body.
2. `/metrics` SHALL follow the learning-loop-metrics spec.
