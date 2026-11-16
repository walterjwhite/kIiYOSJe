/**
 * Interactive mockup of the mind extension — signal-centric redesign.
 * All state lives in window.MOCK_STATE (see data.js) and is mutated directly.
 * This is a UI mockup, not a client for the real server.
 */

(function () {
  "use strict";

  const state = window.MOCK_STATE;

  // ── Utilities ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function relativeTime(iso) {
    if (!iso) return null;
    const diffMs = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diffMs);
    const mins = Math.round(abs / 60000);
    const hours = Math.round(abs / 3600000);
    const days = Math.round(abs / 86400000);
    let label;
    if (mins < 60) label = `${mins}m`;
    else if (hours < 48) label = `${hours}h`;
    else label = `${days}d`;
    return diffMs < 0 ? `${label} ago` : `in ${label}`;
  }

  function clockTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function toast(message, isError) {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function directionName(id) {
    if (!id) return null;
    const d = state.directions.find((x) => x.id === id);
    return d ? d.name : id;
  }

  function thoughtById(id) {
    if (!id) return null;
    return state.thoughts.find((t) => t.id === id) || null;
  }

  /**
   * Shared "decision made, follow-through pending" transition. The item
   * stays in the Queue, in place, shown disabled with a pulsing running
   * badge for a beat, then either closes (moves to Signals) or — if
   * reopen is given — comes back with a fresh request instead of closing,
   * modeling background work that needed the operator again.
   */
  function runThenResolve(sig, runningLabel, { resolution, reopenWith, delayMs } = {}) {
    sig.runningState = { label: runningLabel, startedAt: new Date().toISOString() };
    renderQueueList();
    renderDetail();
    refreshPlanIfVisible();

    setTimeout(() => {
      sig.runningState = null;
      if (reopenWith) {
        sig.request = reopenWith;
        toast(`${sig.summary} — needs you again: ${reopenWith.reason || "see detail"}`);
      } else {
        sig.status = "closed";
        sig.resolution = resolution || "done";
        if (state.selectedSignalId === sig.id) state.selectedSignalId = null;
        toast(`Done: ${sig.summary}`);
      }
      renderQueueList();
      renderDetail();
      refreshPlanIfVisible();
      renderLogView();
    }, delayMs ?? 1800);
  }

  function isOverdue(sig) {
    const by = sig.request?.escalateBy;
    return !!by && new Date(by) <= new Date();
  }

  function confidenceClass(c) {
    if (c == null) return "";
    if (c < 0.5) return "conf-low";
    if (c < 0.75) return "conf-mid";
    return "conf-high";
  }

  const CHANNEL_ICON = { email: "✉", jira: "◧", chat: "💬", calendar: "📅", sms: "📱" };
  const REQUEST_ICON = { "approve-send": "✉", "external-review": "◧", "needs-credential": "⚠", "needs-link": "🔗" };

  // ── Work queue ───────────────────────────────────────────────────────

  function openSignals() {
    return state.signals.filter((s) => s.request && (s.status === "open" || s.runningState));
  }

  function sortedQueue() {
    const items = openSignals();
    const escalations = items.filter((i) => i.request.kind === "needs-credential");
    const rest = items.filter((i) => i.request.kind !== "needs-credential");

    if (state.sortMode === "urgency") {
      rest.sort((a, b) => b.request.urgencyScore - a.request.urgencyScore);
      return [{ label: null, items: [...escalations, ...rest] }];
    }

    const byThread = new Map();
    for (const item of rest) {
      const key = item.threadKey || item.id;
      if (!byThread.has(key)) byThread.set(key, []);
      byThread.get(key).push(item);
    }
    const groups = [...byThread.entries()]
      .map(([key, groupItems]) => ({
        label: key,
        items: groupItems,
        maxUrgency: Math.max(...groupItems.map((i) => i.request.urgencyScore)),
      }))
      .sort((a, b) => b.maxUrgency - a.maxUrgency);

    const result = [];
    if (escalations.length) result.push({ label: null, items: escalations });
    result.push(...groups);
    return result;
  }

  function renderQueueList() {
    const container = document.getElementById("queue-list");
    const groups = sortedQueue();
    const total = openSignals().length;

    if (total === 0) {
      container.innerHTML = `<div class="queue-empty">Queue is empty.<br>Nothing needs you right now.</div>`;
      return;
    }

    container.innerHTML = groups
      .map((group) => {
        const header =
          state.sortMode === "flow" && group.label
            ? `<div class="queue-group-label">${esc(group.label)}</div>`
            : "";
        return header + group.items.map(renderQueueCard).join("");
      })
      .join("");

    container.querySelectorAll("[data-sig-id]").forEach((el) => {
      el.addEventListener("click", () => selectSignal(el.dataset.sigId));
    });
  }

  function renderQueueCard(sig) {
    const req = sig.request;
    const overdue = isOverdue(sig);
    const icon = REQUEST_ICON[req.kind] || "•";
    const channelClass = `channel-${sig.channel}`;
    const running = !!sig.runningState;

    const badges = [];
    if (running) {
      badges.push(`<span class="badge running-badge"><span class="running-dot"></span> ${esc(sig.runningState.label)}</span>`);
    }
    if (req.kind === "external-review" && req.context.confidence != null) {
      badges.push(`<span class="badge ${confidenceClass(req.context.confidence)}">conf ${req.context.confidence.toFixed(2)}</span>`);
    }
    if (req.kind === "needs-credential") {
      badges.push(`<span class="badge overdue">needs OTP</span>`);
    }
    if (req.kind === "needs-link") {
      badges.push(`<span class="badge due">unlinked</span>`);
    }
    if (req.escalateBy && !running) {
      badges.push(`<span class="badge ${overdue ? "overdue" : "due"}">${overdue ? "overdue" : "due"} ${esc(relativeTime(req.escalateBy))}</span>`);
    }

    const selected = state.selectedSignalId === sig.id ? " selected" : "";
    const runningClass = running ? " running" : "";

    return `
      <div class="q-card kind-${esc(req.kind)}${selected}${runningClass}" data-sig-id="${esc(sig.id)}">
        <div class="q-icon ${channelClass}">${CHANNEL_ICON[sig.channel] || icon}</div>
        <div class="q-main">
          <div class="q-title">${esc(sig.summary)}</div>
          <div class="q-meta-row">
            <span class="q-source">${esc(sig.from === "me" ? sig.to : sig.from)}</span>
            ${badges.join("")}
          </div>
        </div>
      </div>
    `;
  }

  function selectSignal(id) {
    state.selectedSignalId = id;
    renderQueueList();
    renderDetail();
  }

  function renderDetail() {
    const pane = document.getElementById("detail-pane");
    const sig = state.signals.find((s) => s.id === state.selectedSignalId);

    if (!sig) {
      pane.innerHTML = `
        <div class="detail-empty">
          <div class="detail-empty-mark">◆</div>
          <p>Select an item from the queue.</p>
        </div>`;
      return;
    }

    pane.innerHTML = `<div class="detail-content">${renderDetailBody(sig)}</div>`;
    wireDetailEvents(pane, sig);
  }

  function thoughtLinkHtml(sig) {
    const thought = thoughtById(sig.thoughtId);
    if (thought) {
      return `
        <div class="thought-link-row">
          <span class="thought-link-kind">${esc(thought.kind)}</span>
          <span class="thought-link-title">${esc(thought.title)}</span>
          <button class="link-btn" data-relink-thought="${esc(sig.id)}">Change</button>
        </div>`;
    }
    const urgent = sig.needsLinking ? " needs-linking" : "";
    return `
      <div class="thought-link-row${urgent}">
        <span class="thought-link-empty">${sig.needsLinking ? "Not linked to a ticket, issue, or thought yet" : "Not linked to anything"}</span>
        <button class="link-btn" data-link-thought="${esc(sig.id)}">Link to a ticket or thought</button>
      </div>`;
  }

  function renderDetailBody(sig) {
    const req = sig.request;
    const kicker = `
      <div class="detail-kicker">
        <span>${esc(sig.channel)}</span><span class="dot">·</span>
        <span>${esc(sig.from === "me" ? `to ${sig.to}` : `from ${sig.from}`)}</span><span class="dot">·</span>
        <span>${esc(relativeTime(sig.timestamp))}</span>
      </div>`;

    const reasonBlock = req?.reason
      ? `<div class="reason-row"><span class="reason-label">Why this needs you</span><p class="reason-text">${esc(req.reason)}</p></div>`
      : "";

    const runningBlock = sig.runningState
      ? `<div class="running-banner"><span class="running-dot"></span> ${esc(sig.runningState.label)} — started ${esc(relativeTime(sig.runningState.startedAt))}. No action needed right now; this will update on its own when it finishes.</div>`
      : "";

    const thoughtBlock = sig.channel === "chat" || sig.thoughtId || sig.needsLinking ? thoughtLinkHtml(sig) : "";

    if (sig.runningState) {
      // Decision already made; follow-through is in progress. Show context
      // read-only instead of live action buttons.
      return kicker + reasonBlock + runningBlock + renderDetailReadOnly(sig) + thoughtBlock;
    }

    if (!req) {
      // Already-resolved / informational signal (closed, sent, or dangling chat).
      if (sig.channel === "chat" && sig.exchange) {
        return kicker + renderChatExchangeDetail(sig) + thoughtBlock;
      }
      return kicker + renderInertDetail(sig) + thoughtBlock;
    }

    if (req.kind === "needs-credential") return kicker + reasonBlock + renderNeedsCredentialDetail(sig) + thoughtBlock;
    if (req.kind === "needs-link") return kicker + reasonBlock + renderNeedsLinkDetail(sig) + thoughtBlock;
    if (req.kind === "external-review") return kicker + reasonBlock + renderExternalReviewDetail(sig) + thoughtBlock;
    return kicker + reasonBlock + renderApproveSendDetail(sig) + thoughtBlock;
  }

  function renderDetailReadOnly(sig) {
    const req = sig.request;
    if (!req) return `<h1 class="detail-title">${esc(sig.summary)}</h1><div class="detail-body-text">${esc(sig.body)}</div>`;
    if (req.kind === "needs-credential") {
      const ctx = req.context;
      const stepsHtml = (ctx.triagePriorSteps || [])
        .map((s) => `
        <div class="stage-chip ${esc(s.status)}">
          <div class="stage-dot">${s.status === "done" ? "✓" : s.status === "blocked" ? "⏸" : "·"}</div>
          <div class="stage-text"><div class="stage-name">${esc(s.name)}</div>${s.detail ? `<div class="stage-detail">${esc(s.detail)}</div>` : ""}</div>
        </div>`)
        .join("");
      return `<h1 class="detail-title">${esc(sig.summary)}</h1><div class="section-label">Triage</div><div class="stage-row">${stepsHtml}</div>`;
    }
    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="detail-sub">${esc(sig.body)}</div>
      <div class="section-label">Approved content</div>
      <div class="draft-box readonly">${esc(req.context?.draft || sig.body)}</div>
    `;
  }

  function renderInertDetail(sig) {
    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="detail-body-text">${esc(sig.body)}</div>
      ${sig.resolution ? `<div class="notes-box">${esc(sig.resolution)}</div>` : ""}
      ${sig.sendSchedule ? `<div class="schedule-row"><span class="schedule-icon">✓</span><span class="schedule-text">Sent ${sig.sendSchedule.mode === "immediate" ? "immediately" : `with the ${esc(sig.sendSchedule.batchLabel)}`}.</span></div>` : ""}
    `;
  }

  // ── Needs-link (dangling, actionable) detail ─────────────────────────

  function renderNeedsLinkDetail(sig) {
    const bubbles = (sig.exchange || [])
      .map((m) => {
        const mine = m.from === "me";
        return `
        <div class="exchange-bubble-row ${mine ? "mine" : "theirs"}">
          <div class="exchange-bubble">
            <div class="exchange-bubble-from">${mine ? "You" : esc(m.from)}</div>
            <div class="exchange-bubble-body">${esc(m.body)}</div>
            <div class="exchange-bubble-time">${esc(clockTime(m.timestamp))}</div>
          </div>
        </div>`;
      })
      .join("");

    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      ${bubbles ? `<div class="exchange-thread">${bubbles}</div>` : `<div class="detail-body-text">${esc(sig.body)}</div>`}
      <div class="action-bar">
        <button class="btn" data-link-thought="${esc(sig.id)}">Link to a ticket or thought</button>
        <button class="btn btn-secondary" data-dismiss-link="${esc(sig.id)}">Dismiss — not actionable</button>
      </div>
    `;
  }

  function wireNeedsLinkEvents(pane, sig) {
    pane.querySelector("[data-dismiss-link]")?.addEventListener("click", () => {
      sig.status = "closed";
      sig.needsLinking = false;
      sig.resolution = "dismissed — not actionable";
      toast(`Dismissed: ${sig.summary}`);
      if (state.selectedSignalId === sig.id) state.selectedSignalId = null;
      renderQueueList();
      renderDetail();
      refreshPlanIfVisible();
      renderLogView();
    });
  }

  // ── Chat exchange (both sides of the conversation) ───────────────────

  function renderChatExchangeDetail(sig) {
    const bubbles = (sig.exchange || [])
      .map((m) => {
        const mine = m.from === "me";
        return `
        <div class="exchange-bubble-row ${mine ? "mine" : "theirs"}">
          <div class="exchange-bubble">
            <div class="exchange-bubble-from">${mine ? "You" : esc(m.from)}</div>
            <div class="exchange-bubble-body">${esc(m.body)}</div>
            <div class="exchange-bubble-time">${esc(clockTime(m.timestamp))}</div>
          </div>
        </div>`;
      })
      .join("");

    const danglingNote = sig.needsLinking
      ? `<div class="notes-box">This chat references work that isn't tracked anywhere yet. Link it to a ticket or thought (existing or new) so it doesn't stay dangling.</div>`
      : "";

    const actionBar = sig.needsLinking
      ? `<div class="action-bar">
          <button class="btn" data-link-thought="${esc(sig.id)}">Link to a ticket or thought</button>
          <button class="btn btn-secondary" data-dismiss-chat="${esc(sig.id)}">Dismiss — no action needed</button>
        </div>`
      : "";

    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="exchange-thread">${bubbles}</div>
      ${danglingNote}
      ${actionBar}
    `;
  }

  function wireChatExchangeEvents(pane, sig) {
    pane.querySelector("[data-dismiss-chat]")?.addEventListener("click", () => {
      sig.status = "closed";
      sig.needsLinking = false;
      sig.resolution = "dismissed — no action needed";
      toast(`Dismissed: ${sig.summary}`);
      renderQueueList();
      renderLogView();
      renderDetail();
    });
  }

  // ── Needs-credential (OTP-gated triage) detail ───────────────────────

  function renderNeedsCredentialDetail(sig) {
    const ctx = sig.request.context;
    const stepsHtml = (ctx.triagePriorSteps || [])
      .map(
        (s) => `
      <div class="stage-chip ${esc(s.status)}">
        <div class="stage-dot">${s.status === "done" ? "✓" : s.status === "blocked" ? "⏸" : "·"}</div>
        <div class="stage-text">
          <div class="stage-name">${esc(s.name)}</div>
          ${s.detail ? `<div class="stage-detail">${esc(s.detail)}</div>` : ""}
        </div>
      </div>
    `,
      )
      .join("");

    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="detail-body-text">${esc(sig.body)}</div>

      <div class="section-label">Triage so far — driven automatically</div>
      <div class="stage-row">${stepsHtml}</div>

      <div class="credential-gate" id="credential-gate-${esc(sig.id)}">
        <div class="credential-gate-icon">🔒</div>
        <div class="credential-gate-body">
          <div class="credential-gate-prompt">${esc(ctx.credentialPrompt)}</div>
          <div class="credential-gate-row">
            <input type="text" inputmode="numeric" maxlength="8" class="otp-input" id="otp-input-${esc(sig.id)}" placeholder="123456" autocomplete="one-time-code">
            <button class="btn" data-resume-triage="${esc(sig.id)}">Provide &amp; resume triage</button>
          </div>
          <div class="credential-gate-note">${esc(ctx.afterReceived)}</div>
        </div>
      </div>
    `;
  }

  function wireNeedsCredentialEvents(pane, sig) {
    pane.querySelector("[data-resume-triage]")?.addEventListener("click", () => {
      const input = document.getElementById(`otp-input-${sig.id}`);
      const otp = (input?.value || "").trim();
      if (!otp) {
        toast("Enter your OTP to resume the triage.", true);
        input?.focus();
        return;
      }

      const stage = sig.request.context.triagePriorSteps.find((s) => s.status === "blocked");
      if (stage) stage.status = "done";

      toast(`OTP accepted. Triage resuming in the background — ${sig.summary}`);
      runThenResolve(sig, "Resuming triage — checking prod audit trail", {
        resolution: "triage resumed with OTP — no match found in prod, closed automatically",
        delayMs: 2200,
      });
    });
  }

  // ── External review detail — renders context.* generically ─────────

  function renderExternalReviewDetail(sig) {
    const ctx = sig.request.context;
    const confClass = confidenceClass(ctx.confidence);
    const confPct = Math.round((ctx.confidence ?? 0) * 100);

    const stagesHtml = (ctx.stages || [])
      .map(
        (s) => `
      <div class="stage-chip ${esc(s.status)}">
        <div class="stage-dot">${s.status === "done" || s.status === "clean" ? "✓" : s.status === "flagged" ? "!" : "·"}</div>
        <div class="stage-text">
          <div class="stage-name">${esc(s.name)}</div>
          ${s.detail ? `<div class="stage-detail">${esc(s.detail)}</div>` : ""}
        </div>
      </div>
    `,
      )
      .join("");

    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="detail-sub">${esc(sig.body)}</div>

      ${ctx.externalUrl ? `<a class="external-link" href="${esc(ctx.externalUrl)}" target="_blank" rel="noopener">Open in source system ↗</a>` : ""}

      ${ctx.confidence != null ? `
      <div class="section-label">Confidence</div>
      <div class="confidence-row">
        <div class="confidence-bar-track"><div class="confidence-bar-fill ${confClass}" style="width:${confPct}%"></div></div>
        <span class="badge ${confClass}">${ctx.confidence.toFixed(2)}</span>
      </div>` : ""}

      ${stagesHtml ? `
      <div class="section-label">What happened</div>
      <div class="stage-row">${stagesHtml}</div>` : ""}

      ${ctx.notes ? `
      <div class="section-label">Notes from the review</div>
      <div class="notes-box">${esc(ctx.notes)}</div>` : ""}

      ${ctx.changedFiles?.length ? `
      <div class="section-label">Files touched</div>
      <div class="file-list">${ctx.changedFiles.map((f) => `<span class="file-chip">${esc(f)}</span>`).join("")}</div>` : ""}

      <div class="action-bar">
        <button class="btn" data-approve-review="${esc(sig.id)}">Approve — hand back to the pipeline</button>
        <button class="btn btn-secondary" data-more-testing="${esc(sig.id)}">Needs more testing</button>
        <button class="btn btn-danger-outline" data-reject-review="${esc(sig.id)}">Send back for another pass</button>
      </div>
    `;
  }

  function wireExternalReviewEvents(pane, sig) {
    pane.querySelector("[data-approve-review]")?.addEventListener("click", () => {
      runThenResolve(sig, "Approved — deploying", {
        resolution: "approved — handed back to source pipeline, deployed",
      });
      toast(`Approved. The source system will continue through deploy on its own.`);
    });
    pane.querySelector("[data-more-testing]")?.addEventListener("click", () => {
      const stage = sig.request.context.stages?.find((s) => s.name === "Human review");
      if (stage) stage.status = "pending";
      toast(`Requested more testing — it stays in the queue.`);
      renderQueueList();
      renderDetail();
    });
    pane.querySelector("[data-reject-review]")?.addEventListener("click", () => {
      runThenResolve(sig, "Sending back for another pass", {
        resolution: "sent back to source pipeline for another pass",
      });
      toast(`Sent back for another pass.`);
    });
  }

  // ── Approve-send (reply draft) detail ────────────────────────────────

  function renderApproveSendDetail(sig) {
    const scheduleHtml = renderScheduleRow(sig);
    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="detail-sub">${esc(sig.body)}</div>

      <div class="section-label">Drafted reply</div>
      <div class="draft-box" contenteditable="true" id="draft-editor-${esc(sig.id)}">${esc(sig.request.context.draft)}</div>

      ${scheduleHtml}

      <div class="action-bar">
        <button class="btn" data-approve-send="${esc(sig.id)}">Approve &amp; schedule send</button>
        <button class="btn btn-danger-outline" data-discard-send="${esc(sig.id)}">Discard</button>
      </div>
    `;
  }

  function renderScheduleRow(sig) {
    return `
      <div class="schedule-row" id="schedule-row-${esc(sig.id)}">
        <span class="schedule-icon">◷</span>
        <span class="schedule-text">Will send with the <strong>next scheduled batch</strong> once approved.</span>
        <button class="link-btn" data-override-schedule="${esc(sig.id)}">Send immediately instead</button>
      </div>
    `;
  }

  function wireApproveSendEvents(pane, sig) {
    let scheduleOverride = false;

    pane.querySelector(`[data-override-schedule]`)?.addEventListener("click", (ev) => {
      scheduleOverride = true;
      const row = document.getElementById(`schedule-row-${sig.id}`);
      row.innerHTML = `
        <span class="schedule-icon">⚡</span>
        <span class="schedule-text">Will send <strong>immediately</strong> once approved.</span>
        <button class="link-btn" data-revert-schedule="${esc(sig.id)}">Use default batch instead</button>
      `;
      row.querySelector("[data-revert-schedule]").addEventListener("click", () => {
        scheduleOverride = false;
        row.outerHTML = renderScheduleRow(sig);
        wireApproveSendEvents(pane, sig);
      });
    });

    pane.querySelector("[data-approve-send]")?.addEventListener("click", () => {
      const editor = document.getElementById(`draft-editor-${sig.id}`);
      const finalBody = editor ? editor.textContent : sig.request.context.draft;
      sig.body = finalBody;
      sig.status = "sent";
      sig.sendSchedule = scheduleOverride
        ? { mode: "immediate", sentAt: new Date().toISOString() }
        : { mode: "batched", batchLabel: "next scheduled batch", sentAt: new Date().toISOString() };

      const runningLabel = scheduleOverride ? "Sending — immediate" : "Sending — next scheduled batch";
      toast(scheduleOverride ? `Sending immediately: ${sig.summary}` : `Approved — will go out with the next batch.`);
      runThenResolve(sig, runningLabel, {
        resolution: `sent ${scheduleOverride ? "immediately" : "with the next scheduled batch"}`,
        delayMs: scheduleOverride ? 1200 : 2000,
      });
    });

    pane.querySelector("[data-discard-send]")?.addEventListener("click", () => {
      sig.status = "closed";
      sig.resolution = "discarded by operator";
      toast(`Discarded: ${sig.summary}`);
      if (state.selectedSignalId === sig.id) state.selectedSignalId = null;
      renderQueueList();
      renderDetail();
      refreshPlanIfVisible();
    });
  }

  function wireDetailEvents(pane, sig) {
    if (sig.runningState) return; // read-only while follow-through is in progress

    const kind = sig.request?.kind;
    if (kind === "needs-credential") wireNeedsCredentialEvents(pane, sig);
    else if (kind === "needs-link") wireNeedsLinkEvents(pane, sig);
    else if (kind === "external-review") wireExternalReviewEvents(pane, sig);
    else if (kind === "approve-send") wireApproveSendEvents(pane, sig);
    else if (sig.channel === "chat" && sig.exchange) wireChatExchangeEvents(pane, sig);

    wireThoughtLinkEvents(pane, sig);
  }

  // ── Thought linking ──────────────────────────────────────────────────

  function wireThoughtLinkEvents(pane, sig) {
    const openBtn = pane.querySelector("[data-link-thought]") || pane.querySelector("[data-relink-thought]");
    openBtn?.addEventListener("click", () => openThoughtPicker(sig));
  }

  function openThoughtPicker(sig) {
    const overlay = document.getElementById("thought-picker-overlay");
    const list = document.getElementById("thought-picker-list");
    const input = document.getElementById("thought-picker-search");

    function renderList(filter) {
      const f = (filter || "").toLowerCase();
      const items = state.thoughts.filter((t) => t.title.toLowerCase().includes(f) || t.kind.includes(f));
      const createRow = f.trim()
        ? `<div class="quick-pick-item" data-create-thought="1">
             <div class="quick-pick-item-label">+ Create new thought: "${esc(filter)}"</div>
           </div>`
        : "";
      list.innerHTML =
        createRow +
        items
          .map(
            (t) => `
        <div class="quick-pick-item" data-thought-id="${esc(t.id)}">
          <div class="quick-pick-item-label">
            <span class="quick-pick-item-check">${sig.thoughtId === t.id ? "✓" : ""}</span>
            ${esc(t.title)}
          </div>
          <div class="quick-pick-item-desc">${esc(t.kind)}</div>
        </div>
      `,
          )
          .join("");

      list.querySelectorAll("[data-thought-id]").forEach((el) => {
        el.addEventListener("click", () => {
          sig.thoughtId = el.dataset.thoughtId;
          sig.needsLinking = false;
          if (sig.request?.kind === "needs-link") {
            sig.status = "closed";
            sig.resolution = `linked to: ${thoughtById(sig.thoughtId).title}`;
            if (state.selectedSignalId === sig.id) state.selectedSignalId = null;
            renderQueueList();
            refreshPlanIfVisible();
          }
          closePicker();
          toast(`Linked to: ${thoughtById(sig.thoughtId).title}`);
          renderDetail();
          renderLogView();
        });
      });
      list.querySelector("[data-create-thought]")?.addEventListener("click", () => {
        const newThought = { id: `th-${state.thoughts.length + 1}`, kind: "discussion", title: filter.trim() };
        state.thoughts.push(newThought);
        sig.thoughtId = newThought.id;
        sig.needsLinking = false;
        if (sig.request?.kind === "needs-link") {
          sig.status = "closed";
          sig.resolution = `linked to new thought: ${newThought.title}`;
          if (state.selectedSignalId === sig.id) state.selectedSignalId = null;
          renderQueueList();
          refreshPlanIfVisible();
        }
        closePicker();
        toast(`Created and linked: ${newThought.title}`);
        renderDetail();
        renderLogView();
      });
    }

    function closePicker() {
      overlay.classList.add("hidden");
      input.removeEventListener("input", onInput);
      document.removeEventListener("keydown", onKeydown);
    }
    function onInput() { renderList(input.value); }
    function onKeydown(ev) { if (ev.key === "Escape") closePicker(); }

    input.value = "";
    renderList("");
    overlay.classList.remove("hidden");
    input.focus();
    input.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) closePicker(); }, { once: true });
  }

  // ── Today ────────────────────────────────────────────────────────────

  function renderPlan() {
    const open = openSignals();
    const escalations = open.filter((s) => s.request.kind === "needs-credential");
    const reviews = open.filter((s) => s.request.kind === "external-review").sort((a, b) => (a.request.context.confidence ?? 1) - (b.request.context.confidence ?? 1));
    const replies = open.filter((s) => s.request.kind === "approve-send");
    const linking = open.filter((s) => s.request.kind === "needs-link");
    const running = state.signals.filter((s) => s.runningState && s.status === "open");
    const activeDirections = state.directions.filter((d) => d.enabled);
    const pendingProposals = state.proposals.filter((p) => p.status === "pending");

    const row = (sig, extra) => `
      <div class="plan-row">
        <span class="plan-row-title" data-open-sig="${esc(sig.id)}">${esc(sig.summary)}</span>
        ${extra || ""}
      </div>
    `;

    return `
      <h1 class="plan-heading">Today</h1>
      <p class="plan-subheading">
        This is the plan for today, and — as you work through it — the record of what happened.
        Items that need you right now always come first. Everything else follows the queue's ${esc(state.sortMode)} order.
      </p>

      ${escalations.length ? `
      <div class="plan-block">
        <div class="plan-block-header urgent">Needs you right now <span class="plan-block-count">${escalations.length}</span></div>
        ${escalations.map((s) => row(s, `<span class="badge overdue">now</span>`)).join("")}
      </div>` : ""}

      <div class="plan-block">
        <div class="plan-block-header">AI work awaiting your review <span class="plan-block-count">${reviews.length}</span></div>
        ${reviews.length
          ? reviews.map((s) => row(s, `<span class="badge ${confidenceClass(s.request.context.confidence)}">conf ${s.request.context.confidence.toFixed(2)}</span>`)).join("")
          : `<div class="plan-empty">Nothing to review — everything else is proceeding on its own.</div>`}
      </div>

      <div class="plan-block">
        <div class="plan-block-header">Drafted replies awaiting approval <span class="plan-block-count">${replies.length}</span></div>
        ${replies.length
          ? replies.map((s) => row(s, `<span class="q-source">${esc(s.from)}</span>`)).join("")
          : `<div class="plan-empty">Nothing pending.</div>`}
      </div>

      ${linking.length ? `
      <div class="plan-block">
        <div class="plan-block-header">Not linked to anything yet <span class="plan-block-count">${linking.length}</span></div>
        ${linking.map((s) => row(s, `<span class="badge due">unlinked</span>`)).join("")}
      </div>` : ""}

      ${running.length ? `
      <div class="plan-block">
        <div class="plan-block-header">Running in the background <span class="plan-block-count">${running.length}</span></div>
        ${running.map((s) => row(s, `<span class="badge running-badge"><span class="running-dot"></span> ${esc(s.runningState.label)}</span>`)).join("")}
      </div>` : ""}

      <div class="plan-block">
        <div class="plan-block-header">Directions in effect <span class="plan-block-count">${activeDirections.length}</span></div>
        ${activeDirections.map((d) => `
          <div class="direction-chip-row">
            <span>${esc(d.name)}</span>
            <span class="posture-tag">${esc(d.posture)}</span>
          </div>
        `).join("")}
      </div>

      <div class="plan-block">
        <div class="plan-block-header">Learning-loop proposals <span class="plan-block-count">${pendingProposals.length}</span></div>
        ${pendingProposals.length
          ? pendingProposals.map((p) => `
            <div class="proposal-card">
              <div class="proposal-title">${esc(p.proposal.kind)}: ${esc(directionName(p.proposal.directionId))} → ${esc(p.proposal.field)} = ${esc(p.proposal.proposedValue)}</div>
              <div class="proposal-rationale">${esc(p.proposal.rationale)}</div>
              <div class="proposal-actions">
                <button class="btn btn-small" data-accept-proposal="${esc(p.eventId)}">Accept</button>
                <button class="btn btn-small btn-secondary" data-reject-proposal="${esc(p.eventId)}">Reject</button>
              </div>
            </div>
          `).join("")
          : `<div class="plan-empty">No pending proposals.</div>`}
      </div>
    `;
  }

  function renderPlanView() {
    document.getElementById("plan-scroll").innerHTML = renderPlan();
    wirePlanEvents();
  }

  function refreshPlanIfVisible() {
    if (state.activeView === "today") renderPlanView();
  }

  function wirePlanEvents() {
    const scroll = document.getElementById("plan-scroll");
    scroll.querySelectorAll("[data-open-sig]").forEach((el) => {
      el.addEventListener("click", () => {
        setView("queue");
        selectSignal(el.dataset.openSig);
      });
    });
    scroll.querySelectorAll("[data-accept-proposal]").forEach((btn) => {
      btn.addEventListener("click", () => resolveProposal(btn.dataset.acceptProposal, "accepted"));
    });
    scroll.querySelectorAll("[data-reject-proposal]").forEach((btn) => {
      btn.addEventListener("click", () => resolveProposal(btn.dataset.rejectProposal, "rejected"));
    });
  }

  function resolveProposal(eventId, resolution) {
    const p = state.proposals.find((x) => x.eventId === eventId);
    if (!p) return;
    p.status = resolution;
    toast(
      resolution === "accepted"
        ? `Accepted. In directions/${p.proposal.directionId}.yaml set ${p.proposal.field}: ${p.proposal.proposedValue}`
        : "Proposal rejected.",
    );
    renderPlanView();
  }

  // ── Signals ──────────────────────────────────────────────────────────

  function filteredLog() {
    return state.signals
      .filter((s) => state.logFilter.channel === "all" || s.channel === state.logFilter.channel)
      .filter((s) => state.logFilter.direction === "all" || s.direction === state.logFilter.direction)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  function statusTagClass(sig) {
    if (sig.status === "open") return "open";
    if (sig.status === "sent") return "sent";
    return "closed";
  }

  function renderLogView() {
    const list = filteredLog();
    document.getElementById("log-count").textContent = `${list.length} signal${list.length === 1 ? "" : "s"}`;

    const container = document.getElementById("log-list");
    if (list.length === 0) {
      container.innerHTML = `<div class="log-empty">No signals match these filters.</div>`;
      return;
    }

    container.innerHTML = list
      .map((sig) => {
        const parties = sig.direction === "in" ? sig.from : `to ${sig.to}`;
        const thought = thoughtById(sig.thoughtId);
        const linkTag = sig.needsLinking
          ? `<span class="log-link-tag unlinked">unlinked</span>`
          : thought
            ? `<span class="log-link-tag linked" title="${esc(thought.title)}">${esc(thought.kind)}</span>`
            : "";
        return `
        <div class="log-row" data-log-sig="${esc(sig.id)}">
          <div class="log-direction-icon ${sig.direction}">${sig.direction === "in" ? "↓" : "↑"}</div>
          <div class="log-channel-tag">${esc(sig.channel)}</div>
          <div class="log-parties">${esc(parties)}</div>
          <div class="log-summary">${esc(sig.summary)}</div>
          ${linkTag}
          <div class="log-status-tag ${statusTagClass(sig)}">${esc(sig.status)}</div>
          <div class="log-time">${esc(clockTime(sig.timestamp))}</div>
        </div>
      `;
      })
      .join("");

    container.querySelectorAll("[data-log-sig]").forEach((el) => {
      el.addEventListener("click", () => {
        const sig = state.signals.find((s) => s.id === el.dataset.logSig);
        if (sig?.request && sig.status === "open") {
          setView("queue");
          selectSignal(sig.id);
        } else if (sig?.channel === "chat") {
          openChatInDetailOverlay(sig);
        } else {
          toast(`${esc(sig.summary)} — ${sig.resolution || sig.status}`);
        }
      });
    });
  }

  function openChatInDetailOverlay(sig) {
    setView("queue");
    selectSignal(sig.id);
  }

  // ── Signal sources (connectors, not signals themselves) ─────────────

  function channelLabel(ch) {
    return { email: "Email", chat: "Chat", jira: "Jira", calendar: "Calendar", sms: "SMS" }[ch] || ch;
  }

  function renderSourcesList() {
    const container = document.getElementById("sources-list");
    if (!state.sources.length) {
      container.innerHTML = `<div class="log-empty">No sources configured.</div>`;
      return;
    }
    container.innerHTML = state.sources
      .map(
        (src) => `
      <div class="source-row" data-source-id="${esc(src.id)}">
        <div class="source-channel-tag">${CHANNEL_ICON[src.channel] || "•"} ${esc(channelLabel(src.channel))}</div>
        <div class="source-label">${esc(src.label)}</div>
        <button class="chip-btn source-toggle ${src.enabled ? "" : "disabled"}" data-toggle-source="${esc(src.id)}">
          <span class="chip-dot ${src.enabled ? "running" : "paused"}"></span> ${src.enabled ? "Enabled" : "Disabled"}
        </button>
        <button class="link-btn danger" data-remove-source="${esc(src.id)}">Remove</button>
      </div>
    `,
      )
      .join("");

    container.querySelectorAll("[data-toggle-source]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = state.sources.find((s) => s.id === btn.dataset.toggleSource);
        if (!src) return;
        src.enabled = !src.enabled;
        toast(`${src.label}: ${src.enabled ? "enabled" : "disabled"}.`);
        renderSourcesList();
      });
    });
    container.querySelectorAll("[data-remove-source]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = state.sources.findIndex((s) => s.id === btn.dataset.removeSource);
        if (idx === -1) return;
        const [removed] = state.sources.splice(idx, 1);
        toast(`Removed source: ${removed.label}`);
        renderSourcesList();
      });
    });
  }

  function openSourcesModal() {
    document.getElementById("sources-overlay").classList.remove("hidden");
    document.getElementById("add-source-label").value = "";
    document.getElementById("add-source-channel").value = "email";
    renderSourcesList();
  }

  function closeSourcesModal() {
    document.getElementById("sources-overlay").classList.add("hidden");
  }

  function createSource() {
    const channel = document.getElementById("add-source-channel").value;
    const label = document.getElementById("add-source-label").value.trim();
    if (!label) {
      toast("Give the source a label — an address, number, or project name.", true);
      return;
    }
    const id = `src-${state.sources.length + 1}`;
    state.sources.push({ id, channel, label, enabled: true });
    document.getElementById("add-source-label").value = "";
    toast(`Added source: ${label}. It will start feeding signals in once connected for real.`);
    renderSourcesList();
  }

  // ── View switching ───────────────────────────────────────────────────

  function setView(view) {
    state.activeView = view;
    document.querySelectorAll(".nav-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    document.getElementById("view-queue").classList.toggle("hidden", view !== "queue");
    document.getElementById("view-today").classList.toggle("hidden", view !== "today");
    document.getElementById("view-signals").classList.toggle("hidden", view !== "signals");
    if (view === "today") renderPlanView();
    if (view === "signals") renderLogView();
  }

  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  // ── Sort toggle ──────────────────────────────────────────────────────

  document.querySelectorAll(".segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sortMode = btn.dataset.sort;
      document.querySelectorAll(".segmented-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderQueueList();
      refreshPlanIfVisible();
    });
  });

  // ── Log filters ──────────────────────────────────────────────────────

  document.getElementById("log-channel-filter").addEventListener("change", (ev) => {
    state.logFilter.channel = ev.target.value;
    renderLogView();
  });
  document.getElementById("log-direction-filter").addEventListener("change", (ev) => {
    state.logFilter.direction = ev.target.value;
    renderLogView();
  });

  // ── Status chips: pause/resume (topbar + Signals toolbar) ───────────

  function renderPauseChip() {
    const html = state.paused
      ? `<span class="chip-dot paused"></span> Paused`
      : `<span class="chip-dot running"></span> Running`;
    document.getElementById("pause-chip").innerHTML = html;
    const signalsChip = document.getElementById("signals-pause-chip");
    if (signalsChip) signalsChip.innerHTML = html;
  }

  function togglePause() {
    state.paused = !state.paused;
    renderPauseChip();
    toast(state.paused ? "Sends paused." : "Sends resumed.");
  }

  document.getElementById("pause-chip").addEventListener("click", togglePause);
  document.getElementById("signals-pause-chip").addEventListener("click", togglePause);

  // ── AI provider picker ───────────────────────────────────────────────

  const PROVIDER_CHOICES = [
    { provider: "ollama", label: "Ollama (local)", description: "Free, runs on this machine, no data leaves the device", defaultModel: "qwen2.5:3b-instruct" },
    { provider: "openai", label: "OpenAI", description: "Cloud — requires an API key", defaultModel: "gpt-4o-mini" },
    { provider: "anthropic", label: "Anthropic", description: "Cloud — requires an API key", defaultModel: "claude-haiku-4-5" },
    { provider: "google", label: "Google", description: "Cloud — requires an API key", defaultModel: "gemini-2.0-flash" },
  ];

  function renderAiChip() {
    const icon = state.aiProvider === "ollama" ? "◧" : "☁";
    const html = `<span class="chip-icon">${icon}</span> ${esc(state.aiProvider)}`;
    document.getElementById("ai-chip").innerHTML = html;
    const signalsChip = document.getElementById("signals-ai-chip");
    if (signalsChip) signalsChip.innerHTML = html;
  }

  // ── AI usage budgets (mockup of mind.ai.* VS Code settings) ──────────

  function openBudgetModal() {
    const b = state.aiBudgets;
    document.getElementById("budget-time-per-task").value = b.timeBudgetMsPerTask;
    document.getElementById("budget-tokens-per-task").value = b.tokenBudgetPerTask;
    document.getElementById("budget-tokens-per-day").value = b.tokenBudgetPerDay;
    document.getElementById("budget-on-exceeded").value = b.onBudgetExceeded;
    renderBudgetUsage();
    document.getElementById("budget-overlay").classList.remove("hidden");
  }

  function closeBudgetModal() {
    document.getElementById("budget-overlay").classList.add("hidden");
  }

  function renderBudgetUsage() {
    const b = state.aiBudgets;
    const pct = b.tokenBudgetPerDay > 0 ? Math.min(100, Math.round((b.tokensUsedToday / b.tokenBudgetPerDay) * 100)) : 0;
    const fill = document.getElementById("budget-usage-fill");
    fill.style.width = `${pct}%`;
    fill.className = `budget-usage-bar-fill ${pct >= 90 ? "over" : pct >= 60 ? "mid" : ""}`;
    document.getElementById("budget-usage-text").textContent =
      b.tokenBudgetPerDay > 0
        ? `${b.tokensUsedToday.toLocaleString()} / ${b.tokenBudgetPerDay.toLocaleString()} tokens (${pct}%)`
        : `${b.tokensUsedToday.toLocaleString()} tokens (no daily limit set)`;
  }

  function saveBudgetSettings() {
    const b = state.aiBudgets;
    b.timeBudgetMsPerTask = Number(document.getElementById("budget-time-per-task").value) || 0;
    b.tokenBudgetPerTask = Number(document.getElementById("budget-tokens-per-task").value) || 0;
    b.tokenBudgetPerDay = Number(document.getElementById("budget-tokens-per-day").value) || 0;
    b.onBudgetExceeded = document.getElementById("budget-on-exceeded").value;
    toast("AI usage budgets saved. Takes effect on the next AI call — no restart needed.");
    closeBudgetModal();
  }

  document.getElementById("ai-chip").addEventListener("click", openAiProviderPicker);
  document.getElementById("signals-ai-chip").addEventListener("click", openAiProviderPicker);
  document.getElementById("signals-sources-btn").addEventListener("click", openSourcesModal);
  document.getElementById("add-source-create").addEventListener("click", createSource);
  document.getElementById("sources-close-btn").addEventListener("click", closeSourcesModal);
  document.getElementById("sources-overlay").addEventListener("click", (ev) => {
    if (ev.target.id === "sources-overlay") closeSourcesModal();
  });
  document.getElementById("budget-chip").addEventListener("click", openBudgetModal);
  document.getElementById("signals-budget-chip").addEventListener("click", openBudgetModal);
  document.getElementById("budget-save-btn").addEventListener("click", saveBudgetSettings);
  document.getElementById("budget-close-btn").addEventListener("click", closeBudgetModal);
  document.getElementById("budget-overlay").addEventListener("click", (ev) => {
    if (ev.target.id === "budget-overlay") closeBudgetModal();
  });

  function openAiProviderPicker() {
    const overlay = document.getElementById("command-palette-overlay");
    const list = document.getElementById("ai-provider-list");
    const input = document.getElementById("ai-provider-search");

    function renderList(filter) {
      const f = (filter || "").toLowerCase();
      const items = PROVIDER_CHOICES.filter((c) => c.label.toLowerCase().includes(f) || c.provider.includes(f));
      list.innerHTML = items
        .map(
          (c) => `
        <div class="quick-pick-item" data-provider="${esc(c.provider)}" data-model="${esc(c.defaultModel)}">
          <div class="quick-pick-item-label">
            <span class="quick-pick-item-check">${c.provider === state.aiProvider ? "✓" : ""}</span>
            ${esc(c.label)}
          </div>
          <div class="quick-pick-item-desc">${esc(c.description)}</div>
        </div>
      `,
        )
        .join("");
      list.querySelectorAll("[data-provider]").forEach((el) => {
        el.addEventListener("click", () => {
          state.aiProvider = el.dataset.provider;
          state.aiModel = el.dataset.model;
          renderAiChip();
          closePicker();
          toast(`AI provider set to ${el.dataset.provider} (${el.dataset.model}). Takes effect on the next signal.`);
        });
      });
    }

    function closePicker() {
      overlay.classList.add("hidden");
      input.removeEventListener("input", onInput);
      document.removeEventListener("keydown", onKeydown);
    }
    function onInput() { renderList(input.value); }
    function onKeydown(ev) { if (ev.key === "Escape") closePicker(); }

    input.value = "";
    renderList("");
    overlay.classList.remove("hidden");
    input.focus();
    input.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) closePicker(); }, { once: true });
  }

  // ── Initial render ───────────────────────────────────────────────────

  renderQueueList();
  renderDetail();
  renderPauseChip();
  renderAiChip();

  // Auto-select the top item so the detail pane isn't empty on first load.
  const first = sortedQueue()[0]?.items?.[0];
  if (first) selectSignal(first.id);
})();
