# Steering updates

`steering.patch` brings the policy steering files in line with what is built. It is a
draft: nothing in `.kiro/steering` has been changed. Review it, then apply it yourself:

```bash
git apply --check .kiro/specs/steering-updates/steering.patch   # confirms it applies
git apply .kiro/specs/steering-updates/steering.patch
git diff .kiro/steering                                         # read it before committing
```

Policy steering is a protected path. If an agent or a pull request applies it, the issue
needs `human-approved-scope`.

## What each file gains

| File               | Change                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security.md`      | Rule 2: data tags and the pattern hold lower the chance of obedience but the gates are the defense. Rule 9: the ACP client cancels permission requests. New rules 13 (a model failure is not a judgement) and 14 (never log a model error object). Threat table: three rows. |
| `privacy-data.md`  | Inventory rows for `sensitive.json`, `resilience.json`, and signals held for the model. Rule 3: model errors log type, status, and code only.                                                                                                                                |
| `product.md`       | Safety posture: sensitive-topic and injection holds; a signal is retried, never guessed, when the model is down.                                                                                                                                                             |
| `ai-quality.md`    | Eval commands, `liveCheck` and `known` fixtures, where prompt versions are recorded (the `signal.processed` event, not the `actions` row), and the real defer-and-retry behavior.                                                                                            |
| `performance.md`   | The resilience defaults and where they live.                                                                                                                                                                                                                                 |
| `observability.md` | `/health` reports the circuit and held signals. Never log a model error object.                                                                                                                                                                                              |
| `tech.md`          | New dependencies and the eval command.                                                                                                                                                                                                                                       |
| `structure.md`     | Where eval data and the runner live.                                                                                                                                                                                                                                         |
| `testing.md`       | The eval layer paths, and the rule that a CommonJS named import can pass tests and still fail in the built server.                                                                                                                                                           |

## Decisions in the patch you may want to change

- `ai-quality.md` now says prompt versions live on the event. The original wording says the
  `actions` row stores them. Storing them on the row needs a migration, which is a separate
  approved change; the patch states what is true today.
- `product.md` lists sensitive topics and injection holds under safety posture. If you would
  rather keep that file to the thesis and non-goals, drop that hunk and keep the one in
  `security.md`.
