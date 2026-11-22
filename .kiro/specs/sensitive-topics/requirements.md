# Requirements — sensitive topics and word matching

## Introduction

Some messages cost too much to answer automatically: legal, financial, health,
or anything the operator names. `sensitiveTopics` was recorded on the classifier
output and ignored. This spec makes it an operator setting that holds a message
for a human, and improves how Directions match words.

## Requirement 1 — The operator owns the list

1. Topics SHALL be stored in `sensitive.json` in the config directory, each with
   a name, keywords, and an on/off switch. The defaults SHALL be `legal`,
   `financial`, and `health`, all on.
2. The operator SHALL edit the list in Settings: add, remove, switch off, and
   change keywords. A topic with no name is removed on save.
3. The list SHALL be validated with zod: a name of 1 to 40 characters, unique
   ignoring case, 1 to 100 keywords of 2 to 80 characters, at most 30 topics. An
   invalid or unreadable file SHALL fall back to the defaults.
4. An empty list SHALL turn the check off.

## Requirement 2 — A topic holds the message

1. WHEN a message contains a keyword of an enabled topic, or the classifier tags
   a topic by its name, THEN a message that would be absorbed SHALL be escalated.
   It SHALL NOT be drafted or sent, whatever its Direction's posture or autonomy.
2. Matching SHALL be on whole words, case-insensitive, and tolerant of word
   forms. "Surgeries" matches "surgery". "Taxi" does not match "tax".
3. The check SHALL run after `decide()`. It SHALL NOT change `decide()` or the
   send gates.
4. A prompt-injection hold SHALL take precedence for the reason shown.
5. The `signal.processed` event SHALL record topic names and SHALL NOT record
   matched words or message text.

## Requirement 3 — Honest cost

1. Every hold is a Thought, so a long keyword list lowers the signals-per-Thought
   ratio. The Settings text SHALL say so.
2. The defaults are English and are a starting point, not a risk classification.

## Requirement 4 — Word matching for Directions

1. A topic or project Direction scope, and each `matchPrompt` phrase, SHALL match
   when its words appear in the message adjacent and in order after stemming. The
   literal substring match SHALL remain, so nothing that matched before stops
   matching.
2. Synonyms SHALL NOT be matched. They belong in `matchPrompt`. Suggesting a
   Direction with a model is a proposal for the operator, not a live matcher,
   because a model must not pick the Direction that decides whether a send is
   allowed.
3. The stemmer is English. Other languages match on whole words without word forms.

## Not decided

- Per-Direction topic lists. Today the list is global.
- Whether the model should be told the topic names in its prompt so it tags them.
  That changes the classifier prompt and needs an evaluation run first.
