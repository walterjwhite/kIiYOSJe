import { join } from "node:path";

/** Where Direction YAML files are read from and written back to. */
export function directionsRoot(): string {
  return (
    process.env["MIND_DIRECTIONS_DIR"] ??
    join(import.meta.dirname, "..", "..", "..", "directions")
  );
}
