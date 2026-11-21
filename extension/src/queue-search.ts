import { ago, channelLabel, timingLabel, type TimingBucket } from "./format.js";
import { planLabel } from "./queue-view.js";

/** The fields of a Queue item that its card displays. */
export interface SearchableItem {
  readonly adapter: string;
  readonly account: string | null;
  readonly sender: string;
  readonly summary: string;
  readonly draftPreview: string | null;
  readonly plannedFor: string | null;
  readonly receivedAt: string;
  readonly direction: { readonly name: string } | null;
  readonly timing: {
    readonly bucket: TimingBucket;
    readonly actBy: string | null;
    readonly reason: string;
  };
}

/**
 * One lower-case string holding every attribute the card shows. The webview
 * keeps it in a data attribute and matches each word of the search box against
 * it, so the search covers exactly what the operator can read, including the
 * parts that appear when a card is expanded. Subject and message body are not
 * shown on the card, so they are not searched.
 */
export function itemSearchText(item: SearchableItem, today: string): string {
  return [
    channelLabel(item.adapter, item.account),
    item.sender,
    item.summary,
    timingLabel(item.timing.bucket, item.timing.actBy),
    item.timing.reason,
    item.direction?.name,
    item.draftPreview,
    planLabel(item.plannedFor, today),
    ago(item.receivedAt),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
}
