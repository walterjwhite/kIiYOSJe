/** Commands that touch the database file directly; no server required. */

import { pause, resume } from "@mind/core";
import { listSnapshots, restore, snapshot } from "@mind/core";
import { print } from "../client.js";

export function pauseSends(): void {
  pause();
  console.log("sends paused — proposals stay, nothing is written");
}

export function resumeSends(): void {
  resume();
  console.log("sends resumed (direction and adapter gates still apply)");
}

export async function takeSnapshot(label?: string): Promise<void> {
  console.log(`snapshot written: ${await snapshot(label)}`);
}

export function snapshots(): void {
  print(listSnapshots());
}

export async function restoreSnapshot(label: string): Promise<void> {
  if (!label) throw new Error("usage: mind restore <label>");
  print(await restore(label));
}
