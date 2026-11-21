# Tasks — local server API

- [x] 1. Bearer auth on all routes, bound to 127.0.0.1, body limit, single error mapper
- [ ] 2. Constant-time token compare (issue: "Compare the API token in constant time")
- [ ] 3. Host and Origin guards, no CORS (issue: "Reject requests with an unexpected Host or Origin header")
- [ ] 4. `MIND_TEST_TOKEN` honored only under test
- [ ] 5. Uniform `{ error, code, details? }` shape verified across routes
- [ ] 6. Pagination caps on list routes
- [ ] 7. OpenAPI document and contract test
- [ ] 8. Version and API version in `/health`; client compatibility message
- [ ] 9. Request logging without query or body
- [ ] 10. `mind token rotate`
