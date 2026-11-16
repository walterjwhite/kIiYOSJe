/**
 * Process entry point for `npm run dev` / `npm start`.
 * index.ts only exports startServer so the CLI can import it without side effects.
 */

import { startServer } from "./index.js";

await startServer();
