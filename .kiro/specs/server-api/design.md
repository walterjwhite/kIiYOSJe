# Design — local server API

## Middleware order

1. `hostGuard`: allowlist `127.0.0.1:8787`, `localhost:8787`; 403 otherwise.
2. `originGuard`: if `Origin` is present, it must match the allowlist; 403 otherwise.
3. `bearerAuth`: constant-time compare using `crypto.timingSafeEqual` on equal-length buffers
   (hash both sides with SHA-256 first to avoid a length oracle).
4. `bodyLimit`.
5. Routes with `@hono/zod-validator`.
6. `errorResponse` as the single error mapper.

Guards run before auth so a rebinding page learns nothing from 401 vs 403 timing.

## Routes

`/health`, `/brief`, `/thoughts`, `/directions`, `/actions`, `/signals`,
`/metrics`, `/admin`, `/proposals`, `/events`, `/queue`. `/signals` is the ingress
for adapters and tests; it uses the same pipeline as in-process adapters.

## Contract

Generate OpenAPI from the zod schemas used by the validators
(`@asteasolutions/zod-to-openapi` is a candidate; check its license and need
before adding any dependency, or hand-write a JSON document and test it against
the router). Commit the document and a contract test.

## Token handling

Generated once with `crypto.randomUUID()` pairs (replace with
`crypto.randomBytes(32)` base64url when auth is next touched). `mind token rotate`
writes a new token and the server re-reads on mtime change.

## Testing

- No token, wrong token, wrong-length token: 401.
- Foreign Host, foreign Origin: 403 before auth.
- Oversized body, invalid body: 413, 400.
- No CORS headers on any response.
- Error responses contain no stack or paths.
