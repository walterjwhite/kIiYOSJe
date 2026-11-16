import { openDb } from "@mind/core";
import { actions, signals } from "@mind/core";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { homedir } from "node:os";

const db = openDb(join(homedir(), ".local", "share", "mind", "demo.db"));

const all = db.select().from(actions).all();
console.log(`total actions in DB: ${all.length}`);
for (const a of all) {
  const sig = db.select().from(signals).where(eq(signals.id, a.signalId)).get();
  const p = JSON.parse(a.payload);
  console.log(`[${a.status}] ext=${sig?.externalId}  body="${p.body.slice(0, 60)}"`);
}
