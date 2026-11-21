/**
 * Fitting message text into a model's context window.
 *
 * A local model has a small window (Ollama defaults to 4096 tokens, shared by
 * the instructions, the message and the answer). A newsletter or a long thread
 * can be tens of thousands of tokens, so the message is condensed and, if it is
 * still too long, cut in the middle: the start and the end of a message carry
 * most of what a classifier or a reply needs. Pure, no I/O.
 */

/**
 * Deliberately pessimistic. English averages about 4 characters per token;
 * URLs, code and non-Latin text average fewer. Overestimating tokens costs a
 * slightly shorter excerpt, underestimating costs a failed call.
 */
export const CHARS_PER_TOKEN = 3;

/** Never shrink the message below this, however small the window. */
const MIN_BODY_TOKENS = 200;

/** Share of the context left unused to absorb estimation error. */
const SAFETY_MARGIN = 0.1;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Removes what costs tokens and says nothing: invisible padding characters
 * (newsletters use them to fill the preview line), tracking URLs, long
 * encoded blobs, and runs of blank space.
 */
export function condense(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200f\u2060\u00ad\u034f\ufeff]/g, "")
    .replace(/https?:\/\/\S{60,}/g, "[link]")
    .replace(/[A-Za-z0-9+/=_-]{120,}/g, "[data]")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface Fitted {
  readonly text: string;
  /** Characters removed by cutting, not counting what condense() dropped. */
  readonly omittedChars: number;
}

/** The message, condensed and, if still over `maxTokens`, cut in the middle (65% start, 35% end). */
export function fitToTokens(text: string, maxTokens: number): Fitted {
  const condensed = condense(text);
  const maxChars = Math.max(MIN_BODY_TOKENS, maxTokens) * CHARS_PER_TOKEN;
  if (condensed.length <= maxChars) return { text: condensed, omittedChars: 0 };

  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  const omitted = condensed.length - head - tail;
  return {
    text: `${condensed.slice(0, head).trimEnd()}\n[… ${omitted} characters omitted to fit the model's context …]\n${condensed.slice(condensed.length - tail).trimStart()}`,
    omittedChars: omitted,
  };
}

/**
 * Tokens available for the message once the instructions and the answer are
 * accounted for. `scaffold` is the whole prompt built with an empty message.
 */
export function bodyBudget(contextTokens: number, scaffold: string, outputReserveTokens: number): number {
  const usable = Math.floor(contextTokens * (1 - SAFETY_MARGIN));
  return Math.max(MIN_BODY_TOKENS, usable - estimateTokens(scaffold) - outputReserveTokens);
}

/** True for a provider's "the prompt does not fit" error, whatever its wording. */
export function isContextOverflow(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /context (size|length|window)|too many tokens|maximum context|exceeds the (available )?context|token limit/i.test(text);
}

/**
 * Runs `attempt` with the message budget, and once more with half of it if the
 * provider still says the prompt does not fit (the estimate can be wrong for
 * unusual text). Any other error is rethrown unchanged.
 */
export async function withShrinkingBody<T>(budgetTokens: number, attempt: (budgetTokens: number) => Promise<T>): Promise<T> {
  try {
    return await attempt(budgetTokens);
  } catch (err) {
    const smaller = Math.floor(budgetTokens / 2);
    if (isContextOverflow(err) && smaller >= MIN_BODY_TOKENS) return attempt(smaller);
    throw err;
  }
}
