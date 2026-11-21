# Demo video — submission prompt

A prompt and shot list for generating the submission video: a ~3 minute,
1920×1080, 16:9 screen-capture video with voiceover. It covers the product
overview first, then the VS Code extension, then the Android client.

Hand **§1 Prompt** and **§4 Voiceover script** to the video tool (or to the
person recording and narrating). The rest is preparation and guardrails.

## 0. At a glance

| | |
| --- | --- |
| Length | 2:55–3:10 |
| Format | 1920×1080, 30 fps, H.264 MP4, stereo AAC |
| Audio | One voice, close-mic or clean TTS, −16 LUFS, music bed optional and low |
| Captions | Burned-in short captions plus an `.srt` sidecar |
| Footage | Real screen recording of the running app; no stock footage, no mocked screens |
| Structure | Overview (0:00–0:42) → VS Code extension (0:42–2:24) → Android (2:24–2:55) → close (2:55–3:05) |
| Extras | 1280×720 thumbnail; check the submission form for its own length limit first |

## 1. Prompt

> Produce a 3-minute product demo video for **mind**, a local, single-operator
> attention manager. The tone is calm, precise and technical — a working tool
> being shown to another engineer, not an advertisement. British-neutral
> English, second person, no hype words ("revolutionary", "seamless",
> "game-changing"), no exclamation marks, no emoji.
>
> **Look:** the real VS Code window and the real Android app on a plain
> desktop/device background. Zoom only to make text legible; never redraw or
> re-create a screen. Cursor movements are deliberate and slow. Transitions
> are cuts or short cross-fades, no motion-graphics wipes. Lower-third labels
> use the product's own vocabulary (`Queue`, `Signals`, `Directions`,
> `Learnings`, `Analytics`, `Devices`).
>
> **Voiceover:** one calm voice, ~140 words per minute, short sentences, a
> small pause between sections. The narration explains *why* a screen exists
> before showing what is on it. It never reads UI labels mechanically and
> never describes something that is not visible.
>
> **Structure and timing:**
> 1. 0:00–0:10 — title card over the Queue: "mind — a local attention
>    manager". One sentence on the problem.
> 2. 0:10–0:42 — high-level overview over a simple four-box diagram
>    (sources → Directions → Queue → you). State that everything runs on one
>    machine, the server is the single source of truth, the VS Code extension
>    and the phone are clients, and nothing is sent without approval.
> 3. 0:42–1:02 — open the mind Activity Bar icon, show the deliberately thin
>    sidebar, open Queue.
> 4. 1:02–1:36 — Queue: goals on the left, items waiting on the right, one
>    item's "when and why", Details (conversation, thought, history),
>    Transcript, and Audio if Piper is installed. Approve one drafted reply.
>    Say plainly that approval is the only place a send is authorised.
> 5. 1:36–1:54 — Signals (today, with a range control) and Directions (the
>    rule table, one row open, Preview).
> 6. 1:54–2:14 — Learnings (proposals from override history) and Analytics
>    (the coverage curve first: weekly absorb rate against number of
>    Directions in force).
> 7. 2:14–2:24 — Devices: name, permissions, six-digit pairing code.
> 8. 2:24–2:55 — Android: pairing screen, then Queue, capture, acknowledge,
>    approve/discard visible only with the `send` permission, and the cached
>    queue labelled stale. Say it is not a second inbox.
> 9. 2:55–3:05 — close on the Queue with the product facts: local SQLite,
>    Node, local Ollama by default, BSD-3-Clause, one operator per instance.
>
> **Accuracy rules (non-negotiable):** show only what is on screen. Do not
> depict a real send leaving the machine — the demo uses a no-op adapter, so
> approving authorises a send in the UI but nothing is delivered. Do not claim
> push notifications, badges, an inbox, a hosted service, or multi-user
> support. Do not show real email addresses, message bodies, credentials,
> tokens, or the token file; use the synthetic demo database and blur anything
> that slips in. If a screen fails during recording, cut it rather than
> staging a fake.
>
> **End card:** "mind — BSD-3-Clause — github.com/<owner>/<repo>" over the
> Queue, held for 4 seconds, no music sting.

## 2. Prepare the demo data

Use the demo database, never a real account. It is seeded from synthetic
signals and replayed through the real pipeline, so what the video shows is
real model output.

```bash
ollama serve && ollama pull qwen2.5:3b-instruct   # first time only
npm run demo:seed                                 # real model calls, a few minutes
npm run demo:serve                                # server on 127.0.0.1:8787, demo.db
```

Build and install the extension once:

```bash
bash scripts/build-extension.sh
code --install-extension extension/mind-vscode-0.0.1.vsix
```

Build and install the Android client (JDK 21, SDK 35):

```bash
cd android && gradle assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For the Android section, pair the phone or emulator on the same private
network. This is the one command that binds beyond loopback:

```bash
MIND_BIND_HOST=0.0.0.0 npm run demo:serve
```

Then in VS Code: **mind → Devices → name + permissions → Show pairing code**,
and enter `http://<machine-address>:8787` plus the six digits in the app.
Grant `read` and `capture` first; grant `send` for the approve/discard part,
or show a second device that has it.

Audio: `pip install piper-tts`, then set the voice in **Settings → Audio
summary** (for example `en_US-lessac-medium`). If Piper is not available,
show **Transcript** only — the Audio button explains what is missing, and
that explanation is not a good demo beat.

## 3. Shot list

| Time | Screen | Action |
| --- | --- | --- |
| 0:00 | Title card over Queue | Hold still; fade in |
| 0:10 | Diagram | Four boxes animate in as they are named |
| 0:42 | VS Code, Activity Bar | Click the mind icon; hover each sidebar row |
| 0:52 | Queue | Drag one item onto a goal; open Details; scroll history |
| 1:08 | Queue item | Click Transcript; if available, play a few seconds of Audio |
| 1:20 | Queue item | Approve a drafted reply; show it leave the queue |
| 1:36 | Signals | Switch range from today to 7d; hover an account label |
| 1:44 | Directions | Open one row; show standard and prompts; run Preview |
| 1:54 | Learnings | Show a narrow/widen proposal and its evidence |
| 2:00 | Analytics | Hover the coverage curve; click one week to drill down |
| 2:14 | Devices | Show the device list, then the pairing panel with a code |
| 2:24 | Android | Pair; then Queue, Details, capture, acknowledge |
| 2:40 | Android | Show approve/discard with `send`; show a read-only device without it |
| 2:46 | Android | Kill the server or leave Wi-Fi; show the cached queue, labelled stale |
| 2:55 | Queue | End card |

## 4. Voiceover script

Times are approximate; trim words rather than speeding up.

**0:00–0:10**
> Your attention is spread across mail, a calendar, pull requests, and a
> phone. mind is a local attention manager that gives back the part that is
> just triage.

**0:10–0:42**
> It runs on one machine: one server, one SQLite file, one process. The
> server is the single source of truth; the editor and the phone are clients.
> You write Directions — rules for how a kind of signal should be handled.
> mind matches incoming signals against them, drafts a reply when one is
> needed, and leaves only the real decisions in a Queue. A thought exists
> only where there is ambiguity, consequence, or a call that belongs to you.
> And nothing is sent until you approve it.

**0:42–1:02**
> The VS Code extension is the main client. The mind icon opens a deliberately
> thin sidebar: one link per section, no live data in view until you open one.
> Queue is the working screen.

**1:02–1:36**
> On the left, your goals. On the right, everything waiting that is not linked
> to one. Each item says when it needs you and why, and offers only the
> actions that fit it. Drag an item onto a goal to link it; new items link
> themselves when the model is confident enough. Transcript gives you the day
> in text. Audio reads exactly that text aloud, rendered on this machine with
> Piper — nothing is uploaded. Details opens the conversation, the thought,
> and the history. Approve a draft, and that is the only place a send is
> authorised.

**1:36–1:54**
> Signals lists every signal, inbound and outbound, today by default. If one
> matched the wrong Direction, reclassify it here. Directions is the rule
> table. Click a row to edit its standard and the prompts the model works
> from, and Preview dry-runs the saved rule against stored signals before you
> rely on it.

**1:54–2:14**
> Learnings shows the policy proposals the learning loop generates from your
> own overrides. Analytics puts the coverage curve first: how much is absorbed
> each week against the number of Directions in force — the ratio the whole
> design is betting on. Click a week to see the signals behind it.

**2:14–2:24**
> Devices is where a second client pairs. Name it, choose its permissions,
> and show a six-digit code.

**2:24–2:55**
> The Android client is not a second inbox. It pairs with that code and gets
> its own credential. With read and capture it can show the Queue, capture a
> thought, acknowledge a signal, and keep the last queue on the device,
> labelled stale when the server cannot be reached. Approve and discard appear
> only when the device was granted send. Revoke it, and it is locked out on its
> next request while every other client keeps working.

**2:55–3:05**
> One operator, one machine, BSD-3-Clause, local Ollama by default. mind is not
> a notification system, not a chat assistant, and not a cloud service. It is
> one local loop that turns a flood of signals into the few decisions that
> need a person.

## 5. On-screen text

Keep captions to one line, lower third, matching the narration:

- `Everything runs on your machine`
- `The server is the single source of truth`
- `Directions are the rules`
- `Approval is the only send`
- `Rendered locally with Piper`
- `Coverage: absorbed signals vs. Directions in force`
- `Each client gets its own scoped credential`
- `Not a second inbox`
- `BSD-3-Clause · local-first`

## 6. Do not show or claim

- Real accounts, real addresses, real message bodies, API keys, device tokens,
  or the contents of `~/.config/kIiYOSJe/mind/`.
- A reply actually arriving in a mailbox. The demo adapter is a no-op.
- Automatic sending. It requires four gates and is off by default; the demo
  does not have them all open.
- Push notifications, badges, counters, an inbox, sync, hosting, teams, or
  multiple operators. None of those exist.
- Model Trace or System Events as part of the default path — they live under
  **Developer** on purpose. Skip them in a 3-minute cut.

## 7. Before exporting

- [ ] Every screen was recorded live in one session; no composited fakes.
- [ ] No secret, token, real address or real message body is legible, including
      in the phone's cached queue and in any terminal scrollback.
- [ ] The narration matches the visuals; no claim outruns the demo.
- [ ] Audio is normalised, no clipping, music below the voice.
- [ ] Captions are burned in and an `.srt` is exported.
- [ ] Duration fits the submission form; if it is shorter, cut the Analytics
      drill-down and the second device before cutting the overview or either
      client.
