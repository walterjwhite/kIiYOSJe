/**
 * Word-level text matching for Directions and sensitive topics.
 *
 * Words come from `Intl.Segmenter` (Unicode word boundaries, built into Node)
 * and are reduced to a stem with the `stemmer` package (Porter, MIT), so
 * "approving budgets" matches the phrase "approve budget". Matching is on whole
 * words in order, never on fragments: "bill" does not match "billion".
 *
 * The stemmer is English. Other languages still match on whole words, just
 * without inflection. Synonyms ("bill" for "invoice") are not handled here;
 * that is what a Direction's `matchPrompt` is for.
 */

import { stemmer } from "stemmer";

const segmenter = new Intl.Segmenter("en", { granularity: "word" });

/** The lowercase stems of the words in `text`, in order. Punctuation is dropped. */
export function stemWords(text: string): string[] {
  const stems: string[] = [];
  for (const part of segmenter.segment(text.toLowerCase())) {
    if (part.isWordLike) stems.push(stemmer(part.segment));
  }
  return stems;
}

/** True when the words of `phrase` appear in `text`, adjacent and in order, after stemming. */
export function containsPhrase(text: string, phrase: string): boolean {
  return containsStems(stemWords(text), stemWords(phrase));
}

/** Like `containsPhrase` with both sides already stemmed, so one message can be checked against many phrases. */
export function containsStems(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  const last = haystack.length - needle.length;
  for (let start = 0; start <= last; start++) {
    let i = 0;
    while (i < needle.length && haystack[start + i] === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}
