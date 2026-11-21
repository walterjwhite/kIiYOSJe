/** Commands that just read (or write one Thought through) the local API. */

import { api, print } from "../client.js";

export async function health(): Promise<void> {
  print(await api("/health"));
}

export async function metrics(window: string): Promise<void> {
  print(await api(`/metrics?window=${window}`));
}

export async function observe(): Promise<void> {
  print(await api("/metrics"));
}

/** The curve rather than the total: absorb rate per week against coverage. */
export async function coverage(weeks: string): Promise<void> {
  print(await api(`/metrics/coverage?weeks=${weeks}`));
}

/** Why did it do that: signal, direction, thought, commitment, actions, events. */
export async function explain(signalId: string): Promise<void> {
  if (!signalId) throw new Error("usage: mind explain <signalId>");
  print(await api(`/signals/${encodeURIComponent(signalId)}/explain`));
}

/** Dry-run a Direction against stored signals; nothing is written. */
export async function preview(directionId: string, classify: boolean): Promise<void> {
  if (!directionId) {
    throw new Error("usage: mind preview <directionId> [--classify]");
  }
  // The id is in the body: Direction ids contain slashes and cannot be a path
  // segment.
  print(await api("/directions/preview", "POST", { directionId, classify }));
}

/** Proposals come from the learning loop; default to the undecided ones. */
export async function proposals(status: string): Promise<void> {
  print(await api(`/proposals?status=${status}&days=30`));
}

export async function capture(title: string): Promise<void> {
  if (!title) throw new Error("usage: mind capture <title>");
  print(await api("/thoughts", "POST", { title, body: "", directionId: null }));
}
