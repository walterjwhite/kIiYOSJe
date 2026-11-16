# mind extension mockup

An interactive, self-contained HTML/JS mockup of the VS Code extension UI —
Activity Bar, Explorer side bar with Thoughts and Review trees, an editor
area with tabs, a status bar, and the Today Brief. No build step, no
server, no VS Code required.

All data is fake (`data.js`) and all state changes are local to the page
(`app.js`) — approving/discarding an action, accepting/rejecting a learning
proposal, and switching the AI provider all mutate an in-memory object and
re-render. Nothing here calls the real `mind` HTTP API; it exists to let you
click through the UI and feel the interaction model before installing the
real extension.

## Open it

Just open `index.html` in a browser — no server needed:

```bash
xdg-open mockup/index.html      # Linux
open mockup/index.html          # macOS
```

Or serve it if your browser blocks local `file://` script loading:

```bash
cd mockup && python3 -m http.server 8911
# then open http://localhost:8911
```

## What you can do

- **Thoughts tree** — click any thought to open it as a read-only tab, styled
  like a markdown preview with its state, direction, and deadlines.
- **Review tree** — hover a proposed action to reveal inline ✓ (approve &
  send) / ✕ (discard) buttons, or click the row to open it in a tab with the
  same two actions as full-size buttons.
- **Today Brief** — click "Open Today Brief" on the welcome tab. Shows active
  thoughts, overdue items, new-today, review-due, actions awaiting approval,
  and pending learning-loop proposals with Accept/Reject buttons.
- **AI provider toggle** — click the provider badge in the status bar
  (bottom right) to open a QuickPick-style picker and switch between Ollama
  and the cloud providers.
- **Pause/resume** — click the run-state badge in the status bar to toggle
  the kill switch.

## Relationship to the real extension

This mirrors `extension/src/*.ts` and the shapes returned by
`packages/server/src/routes/*.ts` closely enough that wiring real `fetch()`
calls in later would be a mechanical change, not a rewrite — but that wiring
does not exist here on purpose. This is a mockup, not a client.
