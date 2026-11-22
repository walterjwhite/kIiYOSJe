/**
 * Prompt versions. Bump one whenever its prompt text or structure changes, so a
 * change in results can be traced to a change in the prompt. Both are recorded on
 * every `signal.processed` event (`ai-quality.md`). The link prompt keeps its own
 * constant in link.ts.
 *
 * Classify: 1 before versions were recorded. 2: the message is in <message> tags
 * with a rule that it is data, and the operator's sensitive topic names are listed.
 * Draft: 1 before versions. 2: the message is in <message> tags with the same rule.
 */
export const CLASSIFY_PROMPT_VERSION = 2;
export const DRAFT_PROMPT_VERSION = 2;
