import { defineConfig } from "drizzle-kit";
import { dbPath } from "./src/config.js";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath(),
  },
  verbose: true,
  strict: true,
});
