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

/** Proposals come from the learning loop; default to the undecided ones. */
export async function proposals(status: string): Promise<void> {
  print(await api(`/proposals?status=${status}`));
}

export async function capture(title: string): Promise<void> {
  if (!title) throw new Error("usage: mind capture <title>");
  print(await api("/thoughts", "POST", { title, body: "", directionId: null }));
}
