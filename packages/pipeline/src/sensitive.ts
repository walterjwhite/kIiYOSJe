/**
 * Which of the operator's sensitive topics a message touches.
 *
 * Two sources, either is enough: the operator's keywords for each enabled topic
 * (whole words, stemmed, no model), and a tag from the classifier that names an
 * enabled topic. Returns topic names only. The message text is never kept.
 * Settings: `@mind/core` sensitive-settings.ts.
 */

import type { SensitiveSettings } from "@mind/core";
import { containsStems, stemWords } from "./text-match.js";

export function findSensitiveTopics(
  text: string,
  modelTags: readonly string[],
  settings: SensitiveSettings,
): string[] {
  const stems = stemWords(text);
  const tags = new Set(modelTags.map((t) => t.trim().toLowerCase()));
  const found: string[] = [];

  for (const topic of settings.topics) {
    if (!topic.enabled) continue;
    const byKeyword = topic.keywords.some((k) => containsStems(stems, stemWords(k)));
    const byTag = tags.has(topic.name.toLowerCase());
    if (byKeyword || byTag) found.push(topic.name);
  }
  return found;
}
