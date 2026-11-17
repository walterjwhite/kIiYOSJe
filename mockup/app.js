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
   *
   * The timer handle is kept on the signal itself (`_runningTimer`) so an
   * "unlock to edit" action can cancel it before it fires — changing your
   * mind mid-flight stops the background work instead of racing it.
   */
  function runThenResolve(sig, runningLabel, { resolution, reopenWith, delayMs } = {}) {
    sig.runningState = { label: runningLabel, startedAt: new Date().toISOString() };
    renderQueueList();
    renderDetail();
    refreshPlanIfVisible();

    sig._runningTimer = setTimeout(() => {
      sig._runningTimer = null;
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

  /**
   * Operator changed their mind about a decision that's mid-flight.
   * Cancels the pending background-work timer, clears runningState, and
   * reopens the item for editing — it reverts to "open" and the request
   * that triggered the run is still intact, so the same action buttons
   * (approve/discard/etc.) come back.
   */
  function unlockRunningSignal(sig) {
    if (sig._runningTimer) {
      clearTimeout(sig._runningTimer);
      sig._runningTimer = null;
    }
    sig.runningState = null;
    sig.status = "open";
    toast(`Paused: ${sig.summary}. Back in the queue to edit.`);
    renderQueueList();
    renderDetail();
    refreshPlanIfVisible();
    renderLogView();
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

  const CHANNEL_ICON = { email: "✉", jira: "◧", chat: "💬", calendar: "📅", sms: "📱", confluence: "📘", github: "🐙", ci: "⚙" };
  const REQUEST_ICON = { "approve-send": "✉", "external-review": "◧", "needs-credential": "⚠", "needs-link": "🔗" };
  const REALTIME_CHANNELS = new Set(["chat"]);

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
    state.detailTab = "action";
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

    const tab = state.detailTab || "action";
    pane.innerHTML = `
      <div class="detail-tabs">
        <button class="detail-tab ${tab === "action" ? "active" : ""}" data-detail-tab="action">Action</button>
        <button class="detail-tab ${tab === "history" ? "active" : ""}" data-detail-tab="history">Work history</button>
      </div>
      <div class="detail-content">${tab === "history" ? renderDetailHistoryTab(sig) : renderDetailBody(sig)}</div>
    `;

    pane.querySelectorAll("[data-detail-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.detailTab = btn.dataset.detailTab;
        renderDetail();
      });
    });

    if (tab === "action") wireDetailEvents(pane, sig);
  }

  /**
   * Work history tab — everything that's happened to this one item: the
   * direction it matched (and why), every schedule/running-state
   * transition, and every event the global History log recorded against
   * it. Separate from the Action tab's "what do I do about this right
   * now" so a cluttered timeline never competes with the controls.
   */
  function renderDetailHistoryTab(sig) {
    const dir = state.directions.find((d) => d.id === sig.directionId);
    const relatedEvents = state.events.filter((e) => e.signalId === sig.id && withinRetention(e)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const thought = thoughtById(sig.thoughtId);

    const infoRows = [
      ["Channel", sig.channel],
      ["Thread key", sig.threadKey || "—"],
      ["Matched direction", dir ? `${dir.name} — ${dir.description}` : "none matched"],
      ["Linked to", thought ? `${thought.kind}: ${thought.title}` : "nothing"],
      ["First seen", new Date(sig.timestamp).toLocaleString()],
    ];

    const timelineRows = relatedEvents.length
      ? relatedEvents.map((e) => `
        <div class="journal-entry">
          <div class="journal-entry-time">${esc(new Date(e.timestamp).toLocaleString())} — ${esc(HISTORY_KIND_LABEL[e.kind] || e.kind)}</div>
          <p class="journal-entry-text">${esc(e.summary)}</p>
        </div>
      `).join("")
      : `<div class="log-empty">No history events recorded against this item yet — events are logged once something actually happens (sent, received, reclassified).</div>`;

    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="section-label">What this item is</div>
      <table class="info-table">
        ${infoRows.map(([k, v]) => `<tr><td class="info-table-key">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
      </table>
      <div class="section-label">Timeline</div>
      <div class="journal-list">${timelineRows}</div>
    `;
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
        <span>${sig.room ? `${esc(sig.room)} (group)` : esc(sig.from === "me" ? `to ${sig.to}` : `from ${sig.from}`)}</span><span class="dot">·</span>
        <span>${esc(relativeTime(sig.timestamp))}</span>
      </div>`;

    const reasonBlock = req?.reason
      ? `<div class="reason-row"><span class="reason-label">Why this needs you</span><p class="reason-text">${esc(req.reason)}</p></div>`
      : "";

    const runningBlock = sig.runningState
      ? `<div class="running-banner">
          <span class="running-dot"></span>
          <span class="running-banner-text">${esc(sig.runningState.label)} — started ${esc(relativeTime(sig.runningState.startedAt))}. No action needed right now; this will update on its own when it finishes.</span>
          <button class="link-btn" data-unlock-running="${esc(sig.id)}">Changed your mind? Pause this and edit</button>
        </div>`
      : "";

    const thoughtBlock = sig.channel === "chat" || sig.thoughtId || sig.needsLinking ? thoughtLinkHtml(sig) : "";
    const composeBlock = renderComposeTrigger(sig);

    if (sig.runningState) {
      // Decision already made; follow-through is in progress. Show context
      // read-only instead of live action buttons.
      return kicker + reasonBlock + runningBlock + renderDetailReadOnly(sig) + thoughtBlock + composeBlock;
    }

    if (!req) {
      // Already-resolved / informational signal (closed, sent, or dangling chat).
      if (sig.channel === "chat" && sig.exchange) {
        return kicker + renderChatExchangeDetail(sig) + thoughtBlock + composeBlock;
      }
      return kicker + renderInertDetail(sig) + thoughtBlock + composeBlock;
    }

    if (req.kind === "needs-credential") return kicker + reasonBlock + renderNeedsCredentialDetail(sig) + thoughtBlock + composeBlock;
    if (req.kind === "needs-link") return kicker + reasonBlock + renderNeedsLinkDetail(sig) + thoughtBlock + composeBlock;
    if (req.kind === "external-review") return kicker + reasonBlock + renderExternalReviewDetail(sig) + thoughtBlock + composeBlock;
    return kicker + reasonBlock + renderApproveSendDetail(sig) + thoughtBlock + composeBlock;
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
    const roomInfo = sig.room
      ? `<div class="notes-box">Group chat in <strong>${esc(sig.room)}</strong> — ${sig.participants?.length || 0} participants. This topic didn't need you; resolved between the people involved.</div>`
      : "";
    const exchangeHtml = sig.exchange?.length
      ? `<div class="section-label">Conversation</div><div class="exchange-thread">${renderExchangeBubbles(sig.exchange)}</div>`
      : "";
    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="detail-body-text">${esc(sig.body)}</div>
      ${roomInfo}
      ${exchangeHtml}
      ${sig.resolution ? `<div class="notes-box">${esc(sig.resolution)}</div>` : ""}
      ${sig.sendSchedule ? `<div class="schedule-row"><span class="schedule-icon">✓</span><span class="schedule-text">Sent ${sig.sendSchedule.mode === "immediate" ? "immediately" : `with the ${esc(sig.sendSchedule.batchLabel)}`}.</span></div>` : ""}
    `;
  }

  // ── Needs-link (dangling, actionable) detail ─────────────────────────

  function renderNeedsLinkDetail(sig) {
    const roomInfo = sig.room
      ? `<div class="notes-box">Group chat in <strong>${esc(sig.room)}</strong> — ${sig.participants?.length || 0} participants. Only this topic is shown; other conversations in the same room that don't involve you are separate signals.</div>`
      : "";
    const body = sig.exchange?.length
      ? `<div class="exchange-thread">${renderExchangeBubbles(sig.exchange)}</div>`
      : `<div class="detail-body-text">${esc(sig.body)}</div>`;

    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      ${roomInfo}
      ${body}
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
    const roomInfo = sig.room
      ? `<div class="notes-box">Group chat in <strong>${esc(sig.room)}</strong> — ${sig.participants?.length || 0} participants.</div>`
      : "";
    const body = `<div class="exchange-thread">${renderExchangeBubbles(sig.exchange)}</div>`;

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
      ${roomInfo}
      ${body}
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
    const exchangeHtml = sig.exchange?.length
      ? `<div class="section-label">Conversation so far</div><div class="exchange-thread">${renderExchangeBubbles(sig.exchange)}</div>`
      : "";
    return `
      <h1 class="detail-title">${esc(sig.summary)}</h1>
      <div class="detail-sub">${esc(sig.body)}</div>
      ${exchangeHtml}

      <div class="section-label">Drafted reply</div>
      <div class="draft-box" contenteditable="true" id="draft-editor-${esc(sig.id)}">${esc(sig.request.context.draft)}</div>

      <div class="section-label">When should this send?</div>
      ${scheduleHtml}

      <div class="action-bar">
        <button class="btn" data-approve-send="${esc(sig.id)}">Write &amp; schedule</button>
        <button class="btn btn-danger-outline" data-discard-send="${esc(sig.id)}">Discard</button>
      </div>
    `;
  }

  function directionSendSchedule(directionId) {
    const d = state.directions.find((x) => x.id === directionId);
    return d?.sendSchedule || { mode: "batched", times: ["17:00"] };
  }

  function nextBatchLabel(schedule) {
    if (!schedule?.times?.length) return "next scheduled batch";
    return `next scheduled batch (${schedule.times.join(", ")})`;
  }

  function renderScheduleRow(sig) {
    const schedule = directionSendSchedule(sig.directionId);
    const override = sig.request?.context?.timingOverride || "default";
    const fixedLabel = schedule.mode === "immediate" ? "immediately (this direction's policy)" : nextBatchLabel(schedule);
    const isRealtime = REALTIME_CHANNELS.has(sig.channel);

    return `
      <div class="schedule-row schedule-row-select" id="schedule-row-${esc(sig.id)}">
        <span class="schedule-icon">◷</span>
        <select class="setting-input" id="timing-select-${esc(sig.id)}" data-timing-select="${esc(sig.id)}">
          <option value="default" ${override === "default" ? "selected" : ""}>Default — ${esc(fixedLabel)}</option>
          <option value="now" ${override === "now" ? "selected" : ""}>Now</option>
          ${isRealtime ? `<option value="recipient-free" ${override === "recipient-free" ? "selected" : ""}>When ${esc(sig.to || "the recipient")} is next free</option>` : ""}
        </select>
      </div>
    `;
  }

  function timingOverrideLabel(sig, override) {
    const schedule = directionSendSchedule(sig.directionId);
    if (override === "now") return "immediately";
    if (override === "recipient-free") return `when ${sig.to || "the recipient"} is next free`;
    return schedule.mode === "immediate" ? "immediately" : nextBatchLabel(schedule);
  }

  function renderExchangeBubbles(exchange) {
    return (exchange || [])
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
  }

  function wireApproveSendEvents(pane, sig) {
    const schedule = directionSendSchedule(sig.directionId);
    let timingOverride = sig.request?.context?.timingOverride || "default";

    pane.querySelector(`[data-timing-select]`)?.addEventListener("change", (ev) => {
      timingOverride = ev.target.value;
    });

    pane.querySelector("[data-approve-send]")?.addEventListener("click", () => {
      const editor = document.getElementById(`draft-editor-${sig.id}`);
      const finalBody = editor ? editor.textContent : sig.request.context.draft;
      const now = new Date().toISOString();
      const immediate = timingOverride === "now" || (timingOverride === "default" && schedule.mode === "immediate");
      sig.body = finalBody;
      sig.status = "sent";
      sig.sendSchedule = {
        mode: timingOverride === "default" ? schedule.mode : timingOverride,
        batchLabel: timingOverrideLabel(sig, timingOverride),
        sentAt: now,
      };

      sig.exchange = sig.exchange || [];
      sig.exchange.push({ from: "me", body: finalBody, timestamp: now });

      state.events.push({
        id: `ev-${state.events.length + 1}`,
        timestamp: now,
        kind: "sent",
        channel: sig.channel,
        person: sig.to,
        summary: sig.summary,
        signalId: sig.id,
      });

      const label = timingOverrideLabel(sig, timingOverride);
      const runningLabel = `Sending — ${label}`;
      toast(`Approved — will send ${label}.`);

      const isAskAi = !!sig.askAi;
      runThenResolve(sig, runningLabel, {
        resolution: `sent ${label}`,
        delayMs: immediate ? 1200 : 2000,
        // For an ask-AI message, the AI is still "in the conversation" —
        // model a reply coming back and the signal reopening with it,
        // instead of just closing once sent.
        reopenWith: isAskAi
          ? {
              kind: "external-review",
              urgencyScore: 20,
              escalateBy: null,
              reason: "A reply came back on the thread you asked the AI to start — reviewing it is informational, nothing further to send unless you want to follow up.",
              context: {
                notes: "Reply received. Use \"Write a message about this\" again if you want the AI to draft a follow-up.",
              },
            }
          : undefined,
      });

      // Simulate the counterparty's reply landing as a new exchange entry
      // once the send completes, for ask-AI threads specifically.
      if (isAskAi) {
        setTimeout(() => {
          const replyBody = "Good call — let's put it behind a flag until the spoofing concern is fully addressed.";
          sig.exchange.push({ from: sig.to, body: replyBody, timestamp: new Date().toISOString() });
          state.events.push({
            id: `ev-${state.events.length + 1}`,
            timestamp: new Date().toISOString(),
            kind: "received",
            channel: sig.channel,
            person: sig.to,
            summary: `Reply: ${replyBody}`,
            signalId: sig.id,
          });
          toast(`${sig.to} replied on the thread you asked AI to start.`);
          renderDetail();
          renderLogView();
        }, (immediate ? 1200 : 2000) + 1500);
      }
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
    wireComposeTrigger(pane, sig);

    if (sig.runningState) {
      // Read-only while follow-through is in progress, except for the
      // "changed your mind" unlock control.
      pane.querySelector("[data-unlock-running]")?.addEventListener("click", () => unlockRunningSignal(sig));
      return;
    }

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
        ? `
           <div class="quick-pick-create-group">
             <div class="quick-pick-create-label">Create new, linked to this signal:</div>
             <div class="quick-pick-item quick-pick-create" data-create-thought="ticket">
               <div class="quick-pick-item-label">+ New ticket: "${esc(filter)}"</div>
             </div>
             <div class="quick-pick-item quick-pick-create" data-create-thought="issue">
               <div class="quick-pick-item-label">+ New issue: "${esc(filter)}"</div>
             </div>
             <div class="quick-pick-item quick-pick-create" data-create-thought="task">
               <div class="quick-pick-item-label">+ New task: "${esc(filter)}"</div>
             </div>
             <div class="quick-pick-item quick-pick-create" data-create-thought="thought">
               <div class="quick-pick-item-label">+ New thought: "${esc(filter)}"</div>
             </div>
           </div>
         `
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
      list.querySelectorAll("[data-create-thought]").forEach((el) => {
        el.addEventListener("click", () => {
          const kind = el.dataset.createThought;
          const newThought = { id: `th-${state.thoughts.length + 1}`, kind, title: filter.trim() };
          state.thoughts.push(newThought);
          sig.thoughtId = newThought.id;
          sig.needsLinking = false;
          if (sig.request?.kind === "needs-link") {
            sig.status = "closed";
            sig.resolution = `linked to new ${kind}: ${newThought.title}`;
            if (state.selectedSignalId === sig.id) state.selectedSignalId = null;
            renderQueueList();
            refreshPlanIfVisible();
          }
          closePicker();
          toast(`Created new ${kind} and linked: ${newThought.title}`);
          renderDetail();
          renderLogView();
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

  // ── Write an outbound signal — compose a goal, AI drafts the actual
  // message. Generic across channels (chat/Teams, email) and available
  // from any signal's detail view. The operator states what they need,
  // not the exact wording; the AI produces a draft the same way it would
  // for any other reply, which then goes through the normal approve-send
  // flow. The operator can override when it sends (default: the owning
  // direction's fixed batch schedule; or now; or when the recipient is
  // free). This is deliberately not an MCP/tool-call integration — it's
  // the same signal model everything else in this mockup uses, just with
  // the AI standing in as the author of the first message.

  let composeContextSig = null;

  function renderComposeTrigger(sig) {
    return `
      <div class="compose-trigger-row">
        <button class="link-btn" data-open-compose="${esc(sig.id)}">✉ Write a message about this</button>
      </div>`;
  }

  function wireComposeTrigger(pane, sig) {
    pane.querySelector("[data-open-compose]")?.addEventListener("click", () => openComposeModal(sig));
  }

  function openComposeModal(sig) {
    composeContextSig = sig;
    const other = sig && (sig.direction === "in" ? sig.from : sig.to);
    document.getElementById("compose-title").textContent = sig ? `Write an outbound signal — re: ${sig.summary}` : "Write an outbound signal";
    document.getElementById("compose-channel").value = sig?.channel === "email" ? "email" : "chat";
    document.getElementById("compose-to").value = other && other !== "me" ? other : "";
    document.getElementById("compose-body").value = "";
    document.getElementById("compose-instructions").value = "";
    document.getElementById("compose-timing").value = "default";
    updateComposeTimingOptions();
    document.getElementById("compose-overlay").classList.remove("hidden");
    document.getElementById("compose-to").focus();
  }

  /**
   * "When the recipient is free" only makes sense for a real-time channel
   * like chat/Teams — email has no concept of the recipient's live
   * presence the way a chat client does, so the option doesn't appear
   * for channels where it wouldn't mean anything.
   */
  function updateComposeTimingOptions() {
    const channel = document.getElementById("compose-channel").value;
    const select = document.getElementById("compose-timing");
    const hasOption = !!select.querySelector('option[value="recipient-free"]');
    const isRealtime = REALTIME_CHANNELS.has(channel);

    if (isRealtime && !hasOption) {
      const opt = document.createElement("option");
      opt.value = "recipient-free";
      opt.textContent = "When the recipient is free";
      select.appendChild(opt);
    } else if (!isRealtime && hasOption) {
      if (select.value === "recipient-free") select.value = "default";
      select.querySelector('option[value="recipient-free"]').remove();
    }
  }

  document.getElementById("compose-channel").addEventListener("change", updateComposeTimingOptions);

  function closeComposeModal() {
    document.getElementById("compose-overlay").classList.add("hidden");
    composeContextSig = null;
  }

  /**
   * Turns a goal + instructions into an actual drafted message. This is a
   * canned stand-in for a real model call — same shape of output a real
   * draft() call would produce, so the rest of the pipeline (approve,
   * schedule, exchange) doesn't need to know the difference.
   */
  function draftMessageFromGoal(goal, instructions, to) {
    const name = (to || "").split("@")[0] || "there";
    const greeting = name && name !== "there" ? `Hey ${name.charAt(0).toUpperCase() + name.slice(1)} — ` : "Hi — ";
    const tail = instructions ? ` (${instructions.trim().replace(/\.$/, "")}.)` : "";
    return `${greeting}${goal.trim().replace(/\.$/, "")}?${tail}`;
  }

  const TIMING_LABEL = {
    default: "the default fixed time for this direction",
    now: "now",
    "recipient-free": "when the recipient is next free (checked against their calendar)",
  };

  function sendComposedMessage() {
    const channel = document.getElementById("compose-channel").value;
    const to = document.getElementById("compose-to").value.trim();
    const goal = document.getElementById("compose-body").value.trim();
    const instructions = document.getElementById("compose-instructions").value.trim();
    const timing = document.getElementById("compose-timing").value;

    if (!to || !goal) {
      toast("Add a recipient and what you need before writing it.", true);
      return;
    }

    const ctx = composeContextSig;
    const direction = state.directions.find((d) => d.id === "demo/pm/ask-ai");
    const id = `s-ask-${state.signals.length + 1}`;
    const now = new Date().toISOString();

    const newSig = {
      id,
      channel,
      direction: "out",
      from: "me",
      to,
      timestamp: now,
      summary: `Draft to ${to}: ${goal.length > 50 ? `${goal.slice(0, 47)}...` : goal}`,
      body: `Asked the AI to find out: ${goal}`,
      status: "open",
      threadKey: ctx?.threadKey || null,
      directionId: direction?.id || null,
      thoughtId: ctx?.thoughtId || null,
      runningState: null,
      askAi: { goal, instructions, askedAt: now, timingOverride: timing },
      exchange: [{ from: "me", body: `(asked AI: ${goal})`, timestamp: now }],
      request: null,
    };
    state.signals.push(newSig);
    closeComposeModal();
    toast("AI is drafting the message…");

    // Model the draft taking a moment, same as any other AI-driven step.
    newSig.runningState = { label: "AI drafting message", startedAt: now };
    renderLogView();

    setTimeout(() => {
      newSig.runningState = null;
      const draft = draftMessageFromGoal(goal, instructions, to);
      newSig.request = {
        kind: "approve-send",
        urgencyScore: 35,
        escalateBy: null,
        reason: `${direction ? direction.name : "ask-ai-requests"} is set to autonomy: draft — the AI drafted this for the question you asked it to write; it still waits for your approval, and will then send at ${TIMING_LABEL[timing]}.`,
        context: { draft, timingOverride: timing },
      };
      toast(`Drafted a message to ${to} — awaiting your approval.`);
      renderQueueList();
      renderLogView();
      refreshPlanIfVisible();
      if (state.activeView === "queue") selectSignal(newSig.id);
    }, 1400);
  }

  document.getElementById("compose-send-btn").addEventListener("click", sendComposedMessage);
  document.getElementById("compose-cancel-btn").addEventListener("click", closeComposeModal);
  document.getElementById("compose-close-btn").addEventListener("click", closeComposeModal);
  document.getElementById("compose-overlay").addEventListener("click", (ev) => {
    if (ev.target.id === "compose-overlay") closeComposeModal();
  });

  // ── Directions: table + detail screen ────────────────────────────────
  // The table (same pattern as Signals/History) is just for scanning;
  // clicking a row opens the direction's own screen to edit name,
  // description, match/response prompts, and policy fields — a direction
  // isn't just a label and a confidence slider, it needs an actual prompt
  // telling the AI how to recognize a match and how to respond to one.

  function signalCountForDirection(directionId) {
    return state.signals.filter((s) => s.directionId === directionId).length;
  }

  function renderDirectionsTable() {
    const body = document.getElementById("directions-table-body");
    body.innerHTML = state.directions
      .map(
        (d) => `
      <tr class="data-table-row" data-direction-row="${esc(d.id)}">
        <td><span class="chip-dot ${d.enabled ? "running" : "paused"}"></span></td>
        <td>${esc(d.name)}</td>
        <td>${esc(d.posture)}</td>
        <td>${esc(d.autonomy)}</td>
        <td>${d.confidenceMin.toFixed(2)}</td>
        <td>${signalCountForDirection(d.id)}</td>
      </tr>
    `,
      )
      .join("");

    body.querySelectorAll("[data-direction-row]").forEach((row) => {
      row.addEventListener("click", () => openDirectionDetail(row.dataset.directionRow));
    });
  }

  function openDirectionDetail(directionId) {
    state.selectedDirectionId = directionId;
    setView("direction-detail");
  }

  function renderDirectionDetail() {
    const d = state.directions.find((x) => x.id === state.selectedDirectionId);
    const body = document.getElementById("direction-detail-body");
    if (!d) {
      body.innerHTML = `<div class="log-empty">Direction not found.</div>`;
      return;
    }

    const relatedLearnings = state.learnings.filter((l) => l.directionId === d.id);
    const relatedReclass = state.reclassifications.filter((r) => r.toDirectionId === d.id || r.fromDirectionId === d.id);
    const handledSignals = state.signals.filter((s) => s.directionId === d.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    body.innerHTML = `
      <label class="add-signal-label">Name</label>
      <input type="text" class="setting-input" id="direction-detail-name" value="${esc(d.name)}">
      <label class="add-signal-label">Description</label>
      <textarea class="setting-input" id="direction-detail-description" style="min-height:50px;">${esc(d.description || "")}</textarea>

      <label class="add-signal-label">Match prompt — how AI decides this direction applies</label>
      <textarea class="setting-input" id="direction-detail-match-prompt" style="min-height:80px;" placeholder="Describe what makes a signal belong to this direction.">${esc(d.matchPrompt || "")}</textarea>

      <label class="add-signal-label">Response prompt — how AI should handle a match</label>
      <textarea class="setting-input" id="direction-detail-response-prompt" style="min-height:80px;" placeholder="Describe how AI should respond once matched.">${esc(d.responsePrompt || "")}</textarea>

      <div class="direction-row-fields" style="margin-top:14px;">
        <label class="direction-field">
          <span>Enabled</span>
          <select class="setting-input" id="direction-detail-enabled">
            <option value="true" ${d.enabled ? "selected" : ""}>enabled</option>
            <option value="false" ${!d.enabled ? "selected" : ""}>disabled</option>
          </select>
        </label>
        <label class="direction-field">
          <span>Posture</span>
          <select class="setting-input" id="direction-detail-posture">
            <option value="absorb" ${d.posture === "absorb" ? "selected" : ""}>absorb</option>
            <option value="escalate" ${d.posture === "escalate" ? "selected" : ""}>escalate</option>
          </select>
        </label>
        <label class="direction-field">
          <span>Autonomy</span>
          <select class="setting-input" id="direction-detail-autonomy">
            <option value="observe" ${d.autonomy === "observe" ? "selected" : ""}>observe</option>
            <option value="draft" ${d.autonomy === "draft" ? "selected" : ""}>draft</option>
            <option value="send" ${d.autonomy === "send" ? "selected" : ""}>send</option>
          </select>
        </label>
        <label class="direction-field">
          <span>Confidence min</span>
          <input type="number" min="0" max="1" step="0.05" class="setting-input" id="direction-detail-confidence" value="${d.confidenceMin}">
        </label>
      </div>
      <div class="direction-row-fields">
        <label class="direction-field">
          <span>Send policy</span>
          <select class="setting-input" id="direction-detail-schedule-mode">
            <option value="batched" ${d.sendSchedule?.mode === "batched" ? "selected" : ""}>batched (default)</option>
            <option value="immediate" ${d.sendSchedule?.mode === "immediate" ? "selected" : ""}>immediate</option>
          </select>
        </label>
        <label class="direction-field">
          <span>Batch times</span>
          <input type="text" class="setting-input" id="direction-detail-schedule-times" value="${esc((d.sendSchedule?.times || []).join(", "))}" placeholder="e.g. 09:00, 17:00">
        </label>
      </div>

      <div class="add-signal-actions">
        <button class="btn" id="direction-detail-save-btn">Save</button>
      </div>

      <div class="section-label">Learnings for this direction <span class="plan-block-count">${relatedLearnings.length}</span> — <button class="link-btn" id="direction-detail-view-learnings">view in Learnings</button></div>
      <div class="learnings-list">${relatedLearnings.length ? relatedLearnings.map(learningRowHtml).join("") : `<div class="log-empty">No learnings recorded for this direction yet.</div>`}</div>

      ${relatedReclass.length ? `
      <div class="section-label">Reclassifications involving this direction</div>
      <div class="learnings-list">${relatedReclass.map(reclassRowHtml).join("")}</div>` : ""}

      <div class="section-label">Signals handled by this direction <span class="plan-block-count">${handledSignals.length}</span></div>
      <table class="data-table">
        <thead><tr><th>Summary</th><th>Status</th><th>When</th><th></th></tr></thead>
        <tbody>
          ${handledSignals.length
            ? handledSignals.map((s) => `
              <tr class="data-table-row" data-handled-sig="${esc(s.id)}">
                <td>${esc(s.summary)}</td>
                <td>${esc(s.status)}</td>
                <td>${esc(clockTime(s.timestamp))}</td>
                <td><button class="link-btn" data-reclassify-sig="${esc(s.id)}">Move to another direction</button></td>
              </tr>
            `).join("")
            : `<tr><td colspan="4" class="log-empty">No signals matched to this direction yet.</td></tr>`}
        </tbody>
      </table>
    `;

    document.getElementById("direction-detail-save-btn").addEventListener("click", () => saveDirectionDetail(d.id));
    document.getElementById("direction-detail-view-learnings").addEventListener("click", () => setView("learnings"));
    body.querySelectorAll("[data-handled-sig]").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-reclassify-sig]")) return;
        setView("queue");
        selectSignal(row.dataset.handledSig);
      });
    });
    body.querySelectorAll("[data-reclassify-sig]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openReclassifyPicker(btn.dataset.reclassifySig);
      });
    });
  }

  function learningRowHtml(l) {
    return `
      <div class="learning-row ${l.status}">
        <div class="learning-row-top">
          <span class="learning-status-tag ${l.status}">${esc(l.status)}</span>
          <span class="learning-row-title">${esc(l.field)}: ${esc(l.fromValue)} → ${esc(l.toValue)}</span>
          <span class="log-time">${esc(clockTime(l.appliedAt))}</span>
        </div>
        <p class="learning-rationale">${esc(l.rationale)}</p>
        ${l.rejectedReason ? `<p class="learning-rationale learning-rejected-reason">Why rejected: ${esc(l.rejectedReason)}</p>` : ""}
      </div>
    `;
  }

  function reclassRowHtml(r) {
    const from = directionName(r.fromDirectionId);
    const to = directionName(r.toDirectionId);
    return `
      <div class="learning-row">
        <div class="learning-row-top">
          <span class="learning-row-title">${esc(r.signalId)}: ${esc(from)} → ${esc(to)}</span>
          <span class="log-time">${esc(clockTime(r.timestamp))}</span>
        </div>
        <p class="learning-rationale">${esc(r.reason)}</p>
      </div>
    `;
  }

  function saveDirectionDetail(directionId) {
    const d = state.directions.find((x) => x.id === directionId);
    if (!d) return;
    d.name = document.getElementById("direction-detail-name").value.trim() || d.name;
    d.description = document.getElementById("direction-detail-description").value.trim();
    d.matchPrompt = document.getElementById("direction-detail-match-prompt").value.trim();
    d.responsePrompt = document.getElementById("direction-detail-response-prompt").value.trim();
    d.enabled = document.getElementById("direction-detail-enabled").value === "true";
    d.posture = document.getElementById("direction-detail-posture").value;
    d.autonomy = document.getElementById("direction-detail-autonomy").value;
    d.confidenceMin = Number(document.getElementById("direction-detail-confidence").value) || 0;
    d.sendSchedule = d.sendSchedule || {};
    d.sendSchedule.mode = document.getElementById("direction-detail-schedule-mode").value;
    d.sendSchedule.times = document.getElementById("direction-detail-schedule-times").value.split(",").map((t) => t.trim()).filter(Boolean);
    toast(`Saved direction: ${d.name}`);
    renderDirectionsTable();
  }

  // ── Reclassification: move a signal that matched the wrong direction ──

  function openReclassifyPicker(signalId) {
    state._reclassifyTarget = signalId;
    const overlay = document.getElementById("reclassify-picker-overlay");
    const list = document.getElementById("reclassify-picker-list");
    const input = document.getElementById("reclassify-picker-search");

    function renderList(filter) {
      const f = (filter || "").toLowerCase();
      const items = state.directions.filter((d) => d.name.toLowerCase().includes(f));
      list.innerHTML = items
        .map(
          (d) => `
        <div class="quick-pick-item" data-reclassify-direction="${esc(d.id)}">
          <div class="quick-pick-item-label">${esc(d.name)}</div>
          <div class="quick-pick-item-desc">${esc(d.description || "")}</div>
        </div>
      `,
        )
        .join("");
      list.querySelectorAll("[data-reclassify-direction]").forEach((el) => {
        el.addEventListener("click", () => {
          const sig = state.signals.find((s) => s.id === state._reclassifyTarget);
          if (!sig) return closePicker();
          const fromId = sig.directionId;
          const toId = el.dataset.reclassifyDirection;
          sig.directionId = toId;
          state.reclassifications.push({
            id: `rc-${state.reclassifications.length + 1}`,
            signalId: sig.id,
            timestamp: new Date().toISOString(),
            fromDirectionId: fromId,
            toDirectionId: toId,
            reason: "Manually reclassified from the Directions screen.",
          });
          toast(`Moved ${sig.id} from ${directionName(fromId) || "no direction"} to ${directionName(toId)}.`);
          closePicker();
          renderDirectionDetail();
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

  function renderLearningsList() {
    const container = document.getElementById("learnings-list");
    if (!state.learnings.length) {
      container.innerHTML = `<div class="log-empty">No learnings yet.</div>`;
      return;
    }
    container.innerHTML = [...state.learnings]
      .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt))
      .map((l) => {
        const dir = state.directions.find((d) => d.id === l.directionId);
        return `
        <div class="learning-row ${l.status}">
          <div class="learning-row-top">
            <span class="learning-status-tag ${l.status}">${esc(l.status)}</span>
            <span class="learning-row-title">${esc(dir ? dir.name : l.directionId)} → ${esc(l.field)}: ${esc(l.fromValue)} → ${esc(l.toValue)}</span>
            <span class="log-time">${esc(clockTime(l.appliedAt))}</span>
          </div>
          <p class="learning-rationale">${esc(l.rationale)}</p>
          ${l.rejectedReason ? `<p class="learning-rationale learning-rejected-reason">Why rejected: ${esc(l.rejectedReason)}</p>` : ""}
          <button class="link-btn" data-view-direction="${esc(l.directionId)}">View direction →</button>
        </div>
      `;
      })
      .join("");

    container.querySelectorAll("[data-view-direction]").forEach((btn) => {
      btn.addEventListener("click", () => openDirectionDetail(btn.dataset.viewDirection));
    });
  }

  function renderLearningRunsTable() {
    const body = document.getElementById("learning-runs-table-body");
    body.innerHTML = [...state.learningRuns]
      .sort((a, b) => new Date(b.ranAt) - new Date(a.ranAt))
      .map(
        (r) => `
      <tr>
        <td>${esc(new Date(r.ranAt).toLocaleString())}</td>
        <td>${r.windowDays}d</td>
        <td>${r.directionsScanned}</td>
        <td>${r.eventsScanned}</td>
        <td>${r.proposalsEmitted}</td>
      </tr>
    `,
      )
      .join("");
  }

  function renderReclassificationsList() {
    const container = document.getElementById("reclassifications-list");
    if (!state.reclassifications.length) {
      container.innerHTML = `<div class="log-empty">No reclassifications yet.</div>`;
      return;
    }
    container.innerHTML = state.reclassifications.map(reclassRowHtml).join("");
  }

  function addDirection() {
    const name = prompt("Direction name (e.g. customer-escalations):");
    if (!name || !name.trim()) return;
    const id = `demo/custom/${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
    state.directions.push({
      id,
      name: name.trim(),
      posture: "absorb",
      autonomy: "observe",
      confidenceMin: 0.6,
      description: "New direction — adjust posture, autonomy, and confidence as you learn how it should behave.",
      matchPrompt: "",
      responsePrompt: "",
      enabled: true,
      sendSchedule: { mode: "batched", times: ["17:00"] },
    });
    toast(`Created direction: ${name.trim()}`);
    renderDirectionsTable();
  }

  document.getElementById("direction-detail-back-btn").addEventListener("click", () => setView("directions"));

  // ── Analytics: volume, override rate, and estimated time saved. ─────
  // Separate from Learnings — Learnings is about policy evolving over
  // time; Analytics is about throughput and what it's worth right now.

  function renderAnalyticsView() {
    const m = state.metrics;
    document.getElementById("analytics-window-label").textContent = m.window;
    hideAnalyticsDrilldown();

    document.getElementById("analytics-summary-row").innerHTML = [
      { label: "Signals", value: m.signals },
      { label: "Absorbed", value: `${Math.round(m.absorbRate * 100)}%` },
      { label: "Override rate", value: `${Math.round(m.overrideRate * 100)}%` },
      { label: "Sends without revert", value: m.sendsWithoutRevert },
      { label: "Est. minutes saved", value: m.byDirection.reduce((sum, d) => sum + d.minutesSavedEst, 0) },
    ]
      .map((card) => `<div class="analytics-card"><div class="analytics-card-value">${esc(card.value)}</div><div class="analytics-card-label">${esc(card.label)}</div></div>`)
      .join("");

    document.getElementById("analytics-direction-table-body").innerHTML = m.byDirection
      .map((row) => {
        const rate = row.handled > 0 ? row.overridden / row.handled : 0;
        return `
        <tr class="data-table-row" data-analytics-direction="${esc(row.directionId)}">
          <td>${esc(directionName(row.directionId) || row.directionId)}</td>
          <td>${row.handled}</td>
          <td>${row.overridden}</td>
          <td><span class="badge ${rate > 0.3 ? "overdue" : rate > 0.1 ? "due" : "conf-high"}">${Math.round(rate * 100)}%</span></td>
          <td>${row.minutesSavedEst}</td>
        </tr>
      `;
      })
      .join("");
    document.querySelectorAll("[data-analytics-direction]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.analyticsDirection;
        showAnalyticsDrilldown(
          `Signals matched to "${directionName(id) || id}"`,
          state.signals.filter((s) => s.directionId === id),
        );
      });
    });

    const maxChannel = Math.max(...m.byChannel.map((c) => c.count), 1);
    document.getElementById("analytics-channel-bars").innerHTML = m.byChannel
      .map(
        (c) => `
      <div class="analytics-bar-row data-table-row" data-analytics-channel="${esc(c.channel)}">
        <span class="analytics-bar-label">${esc(channelLabel(c.channel))}</span>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${(c.count / maxChannel) * 100}%"></div></div>
        <span class="analytics-bar-value">${c.count}</span>
      </div>
    `,
      )
      .join("");
    document.querySelectorAll("[data-analytics-channel]").forEach((row) => {
      row.addEventListener("click", () => {
        const channel = row.dataset.analyticsChannel;
        showAnalyticsDrilldown(
          `${channelLabel(channel)} signals`,
          state.signals.filter((s) => s.channel === channel),
        );
      });
    });

    const maxDaily = Math.max(...m.dailyVolume.map((d) => d.count), 1);
    document.getElementById("analytics-daily-bars").innerHTML = m.dailyVolume
      .map(
        (d) => `
      <div class="analytics-bar-row data-table-row" data-analytics-day="${esc(d.date)}">
        <span class="analytics-bar-label">${esc(new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</span>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${(d.count / maxDaily) * 100}%"></div></div>
        <span class="analytics-bar-value">${d.count}</span>
      </div>
    `,
      )
      .join("");
    document.querySelectorAll("[data-analytics-day]").forEach((row) => {
      row.addEventListener("click", () => {
        const date = row.dataset.analyticsDay;
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart.getTime() + 86400_000);
        showAnalyticsDrilldown(
          `Signals from ${new Date(date).toLocaleDateString()}`,
          state.signals.filter((s) => {
            const t = new Date(s.timestamp).getTime();
            return t >= dayStart.getTime() && t < dayEnd.getTime();
          }),
        );
      });
    });
  }

  function showAnalyticsDrilldown(label, matches) {
    document.getElementById("analytics-drilldown-label").textContent = `${label} (${matches.length})`;
    document.getElementById("analytics-drilldown").classList.remove("hidden");
    renderSignalRows(document.getElementById("analytics-drilldown-list"), matches.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
    document.getElementById("analytics-drilldown").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideAnalyticsDrilldown() {
    document.getElementById("analytics-drilldown").classList.add("hidden");
    document.getElementById("analytics-drilldown-list").innerHTML = "";
  }

  // ── Journal: append-only, operator-written notes ─────────────────────
  // Distinct from `events`: these are notes the person writes themselves,
  // never system-generated, and never edited or removed once added.

  function renderJournalList() {
    const container = document.getElementById("journal-list");
    if (!state.journal.length) {
      container.innerHTML = `<div class="log-empty">No journal entries yet.</div>`;
      return;
    }
    container.innerHTML = [...state.journal]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map(
        (j) => `
      <div class="journal-entry">
        <div class="journal-entry-time">${esc(new Date(j.timestamp).toLocaleString())}</div>
        <p class="journal-entry-text">${esc(j.text)}</p>
      </div>
    `,
      )
      .join("");
  }

  function addJournalEntry() {
    const input = document.getElementById("journal-input");
    const text = input.value.trim();
    if (!text) {
      toast("Write something before adding it to the journal.", true);
      return;
    }
    state.journal.push({
      id: `j-${state.journal.length + 1}`,
      timestamp: new Date().toISOString(),
      text,
    });
    input.value = "";
    toast("Added to journal.");
    renderJournalList();
  }

  // ── Retention: events older than the configured window are treated as
  // pruned — applied wherever `events` is read (currently only the
  // per-item Work History tab, since the standalone History view was
  // folded into Signals).

  function withinRetention(ev) {
    const cutoff = Date.now() - state.historySettings.retentionDays * 86400_000;
    return new Date(ev.timestamp).getTime() >= cutoff;
  }

  const HISTORY_KIND_LABEL = {
    sent: "sent",
    received: "received",
    "learning-applied": "learning",
    "learning-rejected": "learning",
    "direction-edited": "direction",
  };

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

      <div class="plan-block">
        <div class="plan-block-header">Requests you've asked for <span class="plan-block-count">${state.requests.length}</span></div>
        ${state.requests.length
          ? state.requests.map((r) => `
            <div class="plan-row">
              <span class="plan-row-title">${esc(r.text)}</span>
              <span class="badge ${r.status === "done" ? "conf-high" : r.status === "failed" ? "overdue" : "conf-mid"}">${esc(r.status)}</span>
            </div>
          `).join("")
          : `<div class="plan-empty">Nothing asked for yet — ask AI to reach out from any item, or for a summary of a thread.</div>`}
      </div>

      <div class="plan-block">
        <div class="plan-block-header">Knowledge base <span class="plan-block-count">${state.knowledge.length}</span></div>
        <input type="text" class="history-search" id="knowledge-search" placeholder="Ask a question — answers cite their source…" style="width:100%; margin-bottom:10px; box-sizing:border-box;">
        <div id="knowledge-results"></div>
      </div>

      <div class="plan-block">
        <div class="plan-block-header">Connector health <span class="plan-block-count">${state.sources.length}</span></div>
        ${state.sources.map((src) => `
          <div class="direction-chip-row">
            <span>${CHANNEL_ICON[src.channel] || "•"} ${esc(src.label)}</span>
            <span class="source-health-tag ${esc(src.health || "connected")}">${esc(HEALTH_LABEL[src.health] || "Connected")}</span>
          </div>
        `).join("")}
      </div>

      <div class="plan-block">
        <div class="plan-block-header">Paired devices <span class="plan-block-count">${state.devices.length}</span> — <button class="link-btn" id="plan-view-devices-btn">manage in Devices</button></div>
        ${state.devices.map((d) => `
          <div class="direction-chip-row">
            <span>${esc(d.name)}</span>
            <span class="posture-tag">${esc(d.scopes.join(", "))}</span>
          </div>
        `).join("")}
        <p class="setting-desc" style="margin-top:8px;">Settings, queue, journal, and knowledge belong to you, not the device — a change on one shows up on every paired client.</p>
      </div>

      <div class="plan-block">
        <div class="plan-block-header">Daily brief</div>
        <p class="setting-desc">Delivered at <strong>${esc(state.briefSettings.time)}</strong>${state.briefSettings.audioEnabled ? ", text and audio" : ", text only"}. Change the time and voice from Directions once that settings panel exists for real.</p>
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

    const knowledgeSearch = document.getElementById("knowledge-search");
    const knowledgeResults = document.getElementById("knowledge-results");
    function renderKnowledgeResults(query) {
      const q = (query || "").trim().toLowerCase();
      if (!q) {
        knowledgeResults.innerHTML = `<p class="setting-desc">Type a question — results cite the Confluence page, ticket, or doc they came from, never answered without a source.</p>`;
        return;
      }
      const matches = state.knowledge.filter((k) => k.title.toLowerCase().includes(q) || k.source.toLowerCase().includes(q));
      knowledgeResults.innerHTML = matches.length
        ? matches
            .map(
              (k) => `
          <div class="learning-row accepted">
            <div class="learning-row-top">
              <span class="learning-row-title">${esc(k.title)}</span>
              <span class="log-time">${esc(new Date(k.updatedAt).toLocaleDateString())}</span>
            </div>
            <p class="learning-rationale">Source: <a class="external-link" href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.source)} ↗</a></p>
          </div>
        `,
            )
            .join("")
        : `<p class="setting-desc">No match in the knowledge base for "${esc(query)}" — nothing is answered without a source to cite.</p>`;
    }
    knowledgeSearch?.addEventListener("input", (ev) => renderKnowledgeResults(ev.target.value));
    renderKnowledgeResults("");

    document.getElementById("plan-view-devices-btn")?.addEventListener("click", () => setView("devices"));
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
  // Signals absorbed what was a separate History tab — the split wasn't
  // adding clarity. Defaults to "today"; the range selector widens it to
  // 7 days, 30 days, or all time. A signal's own row always reflects its
  // live status (open/sent/closed); nothing is dropped when status
  // changes, so this still works as the durable record once widened.

  function rangeCutoffMs(range) {
    const now = Date.now();
    if (range === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    if (range === "7d") return now - 7 * 86400_000;
    if (range === "30d") return now - 30 * 86400_000;
    return null; // "all"
  }

  function filteredLog() {
    const textLower = (state.logFilter.text || "").trim().toLowerCase();
    const cutoff = rangeCutoffMs(state.logFilter.range);
    return state.signals
      .filter((s) => cutoff == null || new Date(s.timestamp).getTime() >= cutoff)
      .filter((s) => state.logFilter.channel === "all" || s.channel === state.logFilter.channel)
      .filter((s) => state.logFilter.direction === "all" || s.direction === state.logFilter.direction)
      .filter((s) => !textLower || s.summary.toLowerCase().includes(textLower) || s.from.toLowerCase().includes(textLower) || s.to.toLowerCase().includes(textLower))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  function statusTagClass(sig) {
    if (sig.status === "open") return "open";
    if (sig.status === "sent") return "sent";
    return "closed";
  }

  const RANGE_LABEL = { today: "today", "7d": "last 7 days", "30d": "last 30 days", all: "all time" };

  function renderLogView() {
    const list = filteredLog();
    document.getElementById("log-count").textContent = `${list.length} signal${list.length === 1 ? "" : "s"} — ${RANGE_LABEL[state.logFilter.range] || "today"}`;

    renderSignalRows(document.getElementById("log-list"), list);
  }

  /**
   * Shared row renderer so Analytics drill-downs produce exactly the same
   * clickable rows as the main Signals list, instead of a second, looser
   * implementation that could drift from it.
   */
  function renderSignalRows(container, list) {
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
          setView("queue");
          selectSignal(sig.id);
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
    return { email: "Email", chat: "Chat", jira: "Jira", calendar: "Calendar", sms: "SMS", confluence: "Confluence", github: "GitHub", ci: "CI" }[ch] || ch;
  }

  const HEALTH_LABEL = { connected: "Connected", disconnected: "Disconnected", erroring: "Erroring" };

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
        ${src.health ? `<span class="source-health-tag ${esc(src.health)}">${esc(HEALTH_LABEL[src.health] || src.health)}</span>` : ""}
        ${src.firer ? `<span class="source-firer-tag" title="Fires a believable signal every ${Math.round(src.firer.minMs / 1000)}-${Math.round(src.firer.maxMs / 1000)}s while Demo data is on">demo firer</span>` : ""}
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
        if (src.enabled) scheduleDemoFirer(src);
        else if (src._firerTimer) clearTimeout(src._firerTimer);
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
    state.sources.push({ id, channel, label, enabled: true, health: "connected" });
    document.getElementById("add-source-label").value = "";
    toast(`Added source: ${label}. It will start feeding signals in once connected for real.`);
    renderSourcesList();
  }

  // ── Demo mode: sample data connectors firing believable signals ──────
  // Each enabled source with a `firer` schedules its next synthetic
  // signal at a random point in its [minMs, maxMs] window. This models
  // "real connectors receiving real traffic" for demo purposes only —
  // nothing here talks to a real inbox, Jira, or chat.

  const DEMO_FIRER_TEMPLATES = {
    "email-pm": () => ({
      channel: "email",
      from: ["pm-lead@demo.corp", "director@demo.corp", "finance@demo.corp"][Math.floor(Math.random() * 3)],
      summaries: [
        "Quick check — are we still on track for the Friday release?",
        "Can you loop me in on the status of the billing-sync investigation?",
        "Leadership is asking for a one-line update on TICKET-4821.",
      ],
      directionId: "demo/pm/status-requests",
    }),
    "jira-ticket": () => ({
      channel: "jira",
      from: "jira-automation",
      summaries: [
        "TICKET-4901 — add retry backoff to the webhook dispatcher",
        "TICKET-4902 — fix pagination bug in the admin signal list",
      ],
      directionId: "demo/eng/pr-pipeline",
    }),
    "chat-ping": () => ({
      channel: "chat",
      from: ["jordan@demo.corp", "priya@demo.corp", "lin@demo.corp"][Math.floor(Math.random() * 3)],
      summaries: [
        "Did the demo-data firer just create this chat message? 👀",
        "Quick one — do we need a migration for the new source health field?",
        "Heads up, CI's been flaky on main for the last hour.",
      ],
      directionId: null,
    }),
  };

  function fireDemoSignal(source) {
    const template = DEMO_FIRER_TEMPLATES[source.firer.kind];
    if (!template) return;
    const seed = template();
    const summary = seed.summaries[Math.floor(Math.random() * seed.summaries.length)];
    const now = new Date().toISOString();
    const id = `s-demo-${state.signals.length + 1}`;

    const sig = {
      id,
      channel: seed.channel,
      direction: "in",
      from: seed.from,
      to: "me",
      timestamp: now,
      summary,
      body: summary,
      status: "open",
      threadKey: null,
      directionId: seed.directionId,
      thoughtId: null,
      runningState: null,
      request: {
        kind: "approve-send",
        urgencyScore: 20 + Math.floor(Math.random() * 40),
        escalateBy: null,
        reason: seed.directionId
          ? `New signal from ${source.label} — routed through ${directionName(seed.directionId)} the same as anything else on that channel.`
          : `New signal from ${source.label} — no matching direction yet, so it waits here for you to decide.`,
        context: { draft: `Acknowledged — looking into it now.` },
      },
    };
    state.signals.push(sig);
    state.demoMode.firedCount++;
    toast(`Demo data: new signal from ${source.label}.`);
    renderQueueList();
    refreshPlanIfVisible();
    renderLogView();
    scheduleDemoFirer(source);
  }

  function scheduleDemoFirer(source) {
    if (source._firerTimer) clearTimeout(source._firerTimer);
    if (!state.demoMode.enabled || !source.enabled || !source.firer) return;
    const delay = source.firer.minMs + Math.random() * (source.firer.maxMs - source.firer.minMs);
    source._firerTimer = setTimeout(() => fireDemoSignal(source), delay);
  }

  function stopAllDemoFirers() {
    state.sources.forEach((src) => {
      if (src._firerTimer) {
        clearTimeout(src._firerTimer);
        src._firerTimer = null;
      }
    });
  }

  function startAllDemoFirers() {
    state.sources.filter((src) => src.enabled && src.firer).forEach(scheduleDemoFirer);
  }

  function renderDemoModeChip() {
    const chips = [document.getElementById("demo-mode-chip"), document.getElementById("sources-demo-mode-btn")];
    const html = state.demoMode.enabled
      ? `<span class="chip-dot running"></span> Demo data on (${state.demoMode.firedCount} fired)`
      : `<span class="chip-dot paused"></span> Demo data off`;
    chips.forEach((chip) => {
      if (chip) chip.innerHTML = html;
    });
  }

  function toggleDemoMode() {
    state.demoMode.enabled = !state.demoMode.enabled;
    if (state.demoMode.enabled) {
      startAllDemoFirers();
      toast("Demo data on — enabled sources will start firing sample signals.");
    } else {
      stopAllDemoFirers();
      toast("Demo data off.");
    }
    renderDemoModeChip();
  }

  document.getElementById("demo-mode-chip").addEventListener("click", toggleDemoMode);
  document.getElementById("sources-demo-mode-btn").addEventListener("click", toggleDemoMode);

  // ── Devices: paired clients, one person's shared state ──────────────
  // Pairing a new device (the eventual Android app) generates a
  // short-lived code shown here; in the real system, entering that code
  // on the other device completes the pairing and issues it its own
  // credential. There is no second device in this mockup, so "complete
  // pairing" is simulated with a button instead of a real handshake.

  function renderDevicesTable() {
    const body = document.getElementById("devices-table-body");
    body.innerHTML = state.devices
      .map(
        (d) => `
      <tr>
        <td>${esc(d.name)}</td>
        <td>${esc(d.kind)}</td>
        <td>${esc(new Date(d.pairedAt).toLocaleDateString())}</td>
        <td>${d.lastSeen ? esc(relativeTime(d.lastSeen)) : "—"}</td>
        <td>${esc(d.scopes.join(", "))}</td>
        <td><button class="link-btn danger" data-revoke-device="${esc(d.id)}">Revoke</button></td>
      </tr>
    `,
      )
      .join("");

    body.querySelectorAll("[data-revoke-device]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = state.devices.findIndex((d) => d.id === btn.dataset.revokeDevice);
        if (idx === -1) return;
        const [removed] = state.devices.splice(idx, 1);
        toast(`Revoked: ${removed.name}. It's locked out immediately; other devices are unaffected.`);
        renderDevicesTable();
      });
    });
  }

  function startDevicePairing() {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    state.pendingPairing = { code, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    renderPairingPanel();
  }

  function renderPairingPanel() {
    const panel = document.getElementById("devices-pairing-panel");
    const pairing = state.pendingPairing;
    if (!pairing) {
      panel.innerHTML = "";
      return;
    }
    panel.innerHTML = `
      <div class="pairing-panel">
        <div class="pairing-code">${esc(pairing.code.slice(0, 3))} ${esc(pairing.code.slice(3))}</div>
        <p class="setting-desc">
          Enter this code on the device you're pairing (e.g. the Android app) before it expires
          ${esc(relativeTime(pairing.expiresAt))}. Each device gets its own credential and a
          scoped set of permissions — a new phone defaults to the least it needs.
        </p>
        <label class="add-signal-label">Device name</label>
        <input type="text" class="setting-input" id="pairing-device-name" placeholder="e.g. My phone" value="My Android phone">
        <label class="add-signal-label">Permissions for this device</label>
        <div class="pairing-scopes" id="pairing-scopes">
          ${["read", "capture", "send", "render", "settings"]
            .map(
              (scope) => `
            <label class="pairing-scope-option">
              <input type="checkbox" value="${esc(scope)}" ${scope === "read" || scope === "capture" ? "checked" : ""}>
              ${esc(scope)}
            </label>
          `,
            )
            .join("")}
        </div>
        <div class="add-signal-actions">
          <button class="btn" id="pairing-complete-btn">Simulate device entering code</button>
          <button class="btn btn-secondary" id="pairing-cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    document.getElementById("pairing-complete-btn").addEventListener("click", completeDevicePairing);
    document.getElementById("pairing-cancel-btn").addEventListener("click", () => {
      state.pendingPairing = null;
      renderPairingPanel();
    });
  }

  function completeDevicePairing() {
    const name = document.getElementById("pairing-device-name").value.trim() || "New device";
    const scopes = Array.from(document.querySelectorAll("#pairing-scopes input:checked")).map((el) => el.value);
    if (!scopes.length) {
      toast("Give the device at least one permission.", true);
      return;
    }
    state.devices.push({
      id: `dev-${state.devices.length + 1}`,
      name,
      kind: "android",
      pairedAt: new Date().toISOString(),
      scopes,
      lastSeen: new Date().toISOString(),
    });
    state.pendingPairing = null;
    toast(`Paired: ${name}.`);
    renderDevicesTable();
    renderPairingPanel();
  }

  document.getElementById("devices-pair-btn").addEventListener("click", startDevicePairing);

  // ── View switching ───────────────────────────────────────────────────

  function setView(view) {
    state.activeView = view;
    document.querySelectorAll(".nav-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    document.getElementById("view-queue").classList.toggle("hidden", view !== "queue");
    document.getElementById("view-today").classList.toggle("hidden", view !== "today");
    document.getElementById("view-signals").classList.toggle("hidden", view !== "signals");
    document.getElementById("view-directions").classList.toggle("hidden", view !== "directions");
    document.getElementById("view-direction-detail").classList.toggle("hidden", view !== "direction-detail");
    document.getElementById("view-learnings").classList.toggle("hidden", view !== "learnings");
    document.getElementById("view-analytics").classList.toggle("hidden", view !== "analytics");
    document.getElementById("view-journal").classList.toggle("hidden", view !== "journal");
    document.getElementById("view-devices").classList.toggle("hidden", view !== "devices");
    if (view === "today") renderPlanView();
    if (view === "signals") renderLogView();
    if (view === "directions") renderDirectionsTable();
    if (view === "direction-detail") renderDirectionDetail();
    if (view === "learnings") { renderLearningsList(); renderLearningRunsTable(); renderReclassificationsList(); }
    if (view === "analytics") renderAnalyticsView();
    if (view === "journal") renderJournalList();
    if (view === "devices") renderDevicesTable();
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

  // ── Log filters (collapsed behind a search toggle / Ctrl+F) ─────────

  document.getElementById("log-channel-filter").addEventListener("change", (ev) => {
    state.logFilter.channel = ev.target.value;
    renderLogView();
  });
  document.getElementById("log-direction-filter").addEventListener("change", (ev) => {
    state.logFilter.direction = ev.target.value;
    renderLogView();
  });
  document.getElementById("signals-search").addEventListener("input", (ev) => {
    state.logFilter.text = ev.target.value;
    renderLogView();
  });
  document.getElementById("signals-clear-filters-btn").addEventListener("click", () => {
    state.logFilter = { channel: "all", direction: "all", text: "", range: state.logFilter.range };
    document.getElementById("log-channel-filter").value = "all";
    document.getElementById("log-direction-filter").value = "all";
    document.getElementById("signals-search").value = "";
    renderLogView();
  });

  function toggleFiltersRow(rowId, inputId) {
    const row = document.getElementById(rowId);
    const willShow = row.classList.contains("hidden");
    row.classList.toggle("hidden");
    if (willShow) document.getElementById(inputId)?.focus();
  }

  document.getElementById("signals-search-toggle").addEventListener("click", () => toggleFiltersRow("signals-filters-row", "signals-search"));

  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== "f") return;
    if (state.activeView === "signals") {
      ev.preventDefault();
      document.getElementById("signals-filters-row").classList.remove("hidden");
      document.getElementById("signals-search").focus();
    }
  });

  document.querySelectorAll("#signals-range-segmented .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.logFilter.range = btn.dataset.range;
      document.querySelectorAll("#signals-range-segmented .segmented-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderLogView();
    });
  });

  document.getElementById("journal-add-btn").addEventListener("click", addJournalEntry);

  // ── Status chips: pause/resume (topbar + Signals toolbar) ───────────

  function renderPauseChip() {
    const html = state.paused
      ? `<span class="chip-dot paused"></span> Paused`
      : `<span class="chip-dot running"></span> Running`;
    document.getElementById("pause-chip").innerHTML = html;
  }

  function togglePause() {
    state.paused = !state.paused;
    renderPauseChip();
    toast(state.paused ? "Sends paused." : "Sends resumed.");
  }

  document.getElementById("pause-chip").addEventListener("click", togglePause);

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
  }

  // ── AI usage budgets (mockup of mind.ai.* VS Code settings) ──────────

  function openBudgetModal() {
    const b = state.aiBudgets;
    document.getElementById("budget-time-per-task").value = b.timeBudgetMsPerTask;
    document.getElementById("budget-tokens-per-task").value = b.tokenBudgetPerTask;
    document.getElementById("budget-tokens-per-day").value = b.tokenBudgetPerDay;
    document.getElementById("budget-on-exceeded").value = b.onBudgetExceeded;
    document.getElementById("retention-days-input").value = state.historySettings.retentionDays;
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

    const days = Number(document.getElementById("retention-days-input").value);
    if (!days || days < 1) {
      toast("Retention must be at least 1 day.", true);
      return;
    }
    state.historySettings.retentionDays = days;

    toast("Settings saved. Takes effect on the next AI call — no restart needed.");
    closeBudgetModal();
  }

  document.getElementById("ai-chip").addEventListener("click", openAiProviderPicker);
  document.getElementById("signals-sources-btn").addEventListener("click", openSourcesModal);
  document.getElementById("add-source-create").addEventListener("click", createSource);
  document.getElementById("sources-close-btn").addEventListener("click", closeSourcesModal);
  document.getElementById("sources-overlay").addEventListener("click", (ev) => {
    if (ev.target.id === "sources-overlay") closeSourcesModal();
  });
  document.getElementById("settings-chip").addEventListener("click", openBudgetModal);
  document.getElementById("budget-save-btn").addEventListener("click", saveBudgetSettings);
  document.getElementById("budget-close-btn").addEventListener("click", closeBudgetModal);
  document.getElementById("budget-overlay").addEventListener("click", (ev) => {
    if (ev.target.id === "budget-overlay") closeBudgetModal();
  });
  document.getElementById("directions-add-btn").addEventListener("click", addDirection);

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
  renderDemoModeChip();

  // Auto-select the top item so the detail pane isn't empty on first load.
  const first = sortedQueue()[0]?.items?.[0];
  if (first) selectSignal(first.id);
})();
