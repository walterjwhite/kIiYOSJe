/**
 * GET /learnings — the operator's learnings/*.md files, for the Learnings view.
 * Read-only: files are edited in the editor and committed like Directions.
 * Returns titles, scope and file paths, plus the files that were skipped and why.
 * Text is included because the operator wrote it and the view shows it.
 */

import { loadLearnings } from "@mind/pipeline";
import { Hono } from "hono";

export function learningsRouter() {
  const app = new Hono();

  app.get("/", (c) => {
    const { dir, learnings, problems } = loadLearnings();
    return c.json({
      dir,
      learnings: learnings.map((l) => ({
        id: l.id,
        path: l.path,
        title: l.title,
        applies: l.applies,
        direction: l.direction,
        enabled: l.enabled,
        body: l.body,
      })),
      problems,
    });
  });

  return app;
}
