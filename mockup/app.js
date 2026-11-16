/**
 * Interactive mockup of the mind VS Code extension — work-queue redesign.
 * All state lives in window.MOCK_STATE (see data.js) and is mutated directly —
 * this is a UI mockup, not a client for the real server.
 */

(function () {
  "use strict";

  const state = window.MOCK_STATE;
  const openTabs = new Map();
  let activeTabId = "welcome";

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

  function toast(message, isError) {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function directionName(id) {
    if (!id) return null;
    const d = state.directions.find((x) => x.id === id);
    return d ? d.name : id;
  }

  function isOverdue(item) {
    return !!item.escalateBy && new Date(item.escalateBy) <= new Date();
  }

  function confidenceClass(c) {
    if (c == null) return "";
    if (c < 0.5) return "low";
    if (c < 0.75) return "mid";
    return "high";
  }

  const KIND_ICON = {
    escalation: "🔥",
    review: "🔍",
    "reply-draft": "✉",
  };

  // ── Work queue ───────────────────────────────────────────────────────

  function openQueueItems() {
    return state.queue.filter((q) => q.status === "open");
  }

  function sortedQueue() {
    const items = openQueueItems();
    const escalations = items.filter((i) => i.kind === "escalation");
    const rest = items.filter((i) => i.kind !== "escalation");

    if (state.sortMode === "urgency") {
      rest.sort((a, b) => b.urgencyScore - a.urgencyScore);
      return { groups: [{ label: null, items: [...escalations, ...rest] }] };
    }

    // "flow" mode: escalations still pinned first, then grouped by threadKey,
    // groups ordered by their most urgent member, preserving natural
    // conversation/ticket continuity within a group.
    const byThread = new Map();
    for (const item of rest) {
      if (!byThread.has(item.threadKey)) byThread.set(item.threadKey, []);
      byThread.get(item.threadKey).push(item);
    }
    const groups = [...byThread.entries()]
      .map(([threadKey, groupItems]) => ({
        label: threadKey,
        items: groupItems,
        maxUrgency: Math.max(...groupItems.map((i) => i.urgencyScore)),
      }))
      .sort((a, b) => b.maxUrgency - a.maxUrgency);

    const result = [];
    if (escalations.length) result.push({ label: null, items: escalations });
    result.push(...groups);
    return { groups: result };
  }

  function renderQueue() {
    const container = document.getElementById("tree-queue");
    const { groups } = sortedQueue();
    const totalOpen = openQueueItems().length;

    if (totalOpen === 0) {
      container.innerHTML = `<div class="tree-empty-state">Queue is empty. Nothing needs you right now.</div>`;
      return;
    }

    container.innerHTML = groups
      .map((group) => {
        const groupHeader =
          state.sortMode === "flow" && group.label
            ? `<div class="queue-group-header">${esc(group.label)}</div>`
            : "";
        return groupHeader + group.items.map(renderQueueItem).join("");
      })
      .join("");

    wireQueueItemEvents(container);
  }

  function renderQueueItem(item) {
    const icon = KIND_ICON[item.kind] || "•";
    const overdue = isOverdue(item);
    const metaBits = [];

    if (item.kind === "review" && item.confidence != null) {
      metaBits.push(
        `<span class="confidence-badge ${confidenceClass(item.confidence)}">conf ${item.confidence.toFixed(2)}</span>`,
      );
    }
    if (item.escalateBy) {
      metaBits.push(
        `<span class="queue-item-meta${overdue ? " state-active" : ""}">${overdue ? "overdue " : "due "}${esc(relativeTime(item.escalateBy))}</span>`,
      );
    } else {
      metaBits.push(`<span class="queue-item-meta">no deadline</span>`);
    }

    let actions = "";
    if (item.kind === "reply-draft") {
      actions = `
        <div class="queue-item-actions">
          <button class="tree-item-action-btn approve" data-approve="${esc(item.id)}" title="Approve & Send">✓</button>
          <button class="tree-item-action-btn discard" data-discard="${esc(item.id)}" title="Discard">✕</button>
        </div>`;
    } else if (item.kind === "escalation") {
      actions = `
        <div class="queue-item-actions">
          <button class="tree-item-action-btn" data-acknowledge="${esc(item.id)}" title="Acknowledge">✓</button>
        </div>`;
    }
    // review items have no inline action — they require opening to see stages

    return `
      <div class="queue-item kind-${esc(item.kind)}" data-queue-id="${esc(item.id)}">
        <span class="queue-item-icon">${icon}</span>
        <div class="queue-item-main">
          <div class="queue-item-title">${esc(item.title)}</div>
          <div class="queue-item-sub">${metaBits.join("")}</div>
        </div>
        ${actions}
      </div>
    `;
  }

  function wireQueueItemEvents(container) {
    container.querySelectorAll("[data-queue-id]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-approve],[data-discard],[data-acknowledge]")) return;
        const item = state.queue.find((q) => q.id === el.dataset.queueId);
        if (item) openQueueItemTab(item);
      });
    });
    container.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        approveReply(btn.dataset.approve);
      });
    });
    container.querySelectorAll("[data-discard]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        discardReply(btn.dataset.discard);
      });
    });
    container.querySelectorAll("[data-acknowledge]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        acknowledgeEscalation(btn.dataset.acknowledge);
      });
    });
  }

  function openQueueItemTab(item) {
    const tabId = `queue-${item.id}`;
    if (item.kind === "review") {
      openTab(tabId, item.title, () => renderReviewPane(item), (pane) => wireReviewPaneEvents(pane, item));
    } else if (item.kind === "reply-draft") {
      openTab(tabId, item.title, () => renderReplyPane(item), (pane) => wireReplyPaneEvents(pane, item));
    } else {
      openTab(tabId, item.title, () => renderEscalationPane(item), (pane) => wireEscalationPaneEvents(pane, item));
    }
  }

  // ── Escalation detail ────────────────────────────────────────────────

  function renderEscalationPane(item) {
    return `
      <div class="markdown-pane">
        <h1>🔥 ${esc(item.title)}</h1>
        <p>${esc(item.summary)}</p>
        <div class="meta-block">
          <div><strong>Source:</strong> ${esc(item.source)}</div>
          <div><strong>Direction:</strong> ${esc(directionName(item.directionId) || "—")}</div>
          <div><strong>Status:</strong> this bypassed autonomy entirely — nothing was drafted or sent automatically.</div>
        </div>
        <div style="margin-top: 20px;">
          <button class="btn" data-ack="${esc(item.id)}">✓ Acknowledge — I'm on it</button>
        </div>
      </div>
    `;
  }

  function wireEscalationPaneEvents(pane, item) {
    pane.querySelector("[data-ack]")?.addEventListener("click", () => {
      acknowledgeEscalation(item.id);
      closeTab(`queue-${item.id}`);
    });
  }

  function acknowledgeEscalation(id) {
    const item = state.queue.find((q) => q.id === id);
    if (!item) return;
    item.status = "acknowledged";
    renderQueue();
    refreshPlanTabIfOpen();
    toast(`Acknowledged: ${item.title}`);
  }

  // ── Review detail (Jira ticket -> PR pipeline) ──────────────────────

  const STAGE_ICON = {
    done: "✓",
    clean: "✓",
    flagged: "⚠",
    pending: "○",
    blocked: "◌",
  };

  function renderReviewPane(item) {
    const stagesHtml = item.stages
      .map(
        (s, i) => `
      ${i > 0 ? '<span class="stage-arrow">→</span>' : ""}
      <div class="stage-chip ${esc(s.status)}" title="${esc(s.detail || "")}">
        <span class="stage-icon">${STAGE_ICON[s.status] || "○"}</span>
        ${esc(s.name)}
      </div>
    `,
      )
      .join("");

    const confClass = confidenceClass(item.confidence);
    const confLabel = item.confidence < 0.5 ? "low" : item.confidence < 0.75 ? "medium" : "high";

    return `
      <div class="markdown-pane">
        <h1>🔍 ${esc(item.title)}</h1>
        <p>${esc(item.summary)}</p>

        <div style="margin: 8px 0;">
          <span class="confidence-badge ${confClass}">confidence ${item.confidence.toFixed(2)} (${confLabel})</span>
        </div>

        <div class="stage-pipeline">${stagesHtml}</div>

        ${item.notes ? `<div class="review-notes"><strong>Adversarial review notes:</strong><br>${esc(item.notes)}</div>` : ""}

        ${item.diffSummary ? `<div class="diff-summary">Changed: ${esc(item.diffSummary)}</div>` : ""}

        <div class="meta-block">
          <div><strong>Direction:</strong> ${esc(directionName(item.directionId) || "—")}</div>
          <div><strong>Review requested:</strong> ${esc(relativeTime(item.createdAt))}</div>
        </div>

        <div style="margin-top: 20px; display: flex; gap: 8px;">
          <button class="btn" data-review-approve="${esc(item.id)}">✓ Approve — open the PR</button>
          <button class="btn btn-secondary" data-review-more-testing="${esc(item.id)}">🧪 Needs more testing</button>
          <button class="btn btn-secondary" data-review-reject="${esc(item.id)}">✕ Send back to AI</button>
        </div>
      </div>
    `;
  }

  function wireReviewPaneEvents(pane, item) {
    pane.querySelector("[data-review-approve]")?.addEventListener("click", () => {
      resolveReview(item.id, "approved");
    });
    pane.querySelector("[data-review-more-testing]")?.addEventListener("click", () => {
      resolveReview(item.id, "more-testing");
    });
    pane.querySelector("[data-review-reject]")?.addEventListener("click", () => {
      resolveReview(item.id, "sent-back");
    });
  }

  function resolveReview(id, outcome) {
    const item = state.queue.find((q) => q.id === id);
    if (!item) return;
    const tabId = `queue-${id}`;

    if (outcome === "approved") {
      item.status = "done";
      toast(`PR opened for ${item.title}. AI will take it from here through deploy.`);
      closeTab(tabId);
    } else if (outcome === "more-testing") {
      const stage = item.stages.find((s) => s.name === "Human review");
      if (stage) stage.status = "pending";
      toast(`Requested more testing on ${item.title} — it stays in the queue.`);
    } else {
      item.status = "sent-back";
      toast(`Sent ${item.title} back to AI for another pass.`);
      closeTab(tabId);
    }
    renderQueue();
    refreshPlanTabIfOpen();
  }

  // ── Reply draft detail ───────────────────────────────────────────────

  function renderReplyPane(item) {
    return `
      <div class="markdown-pane">
        <h1>✉ ${esc(item.title)}</h1>
        <p><strong>From:</strong> ${esc(item.source)}</p>
        <p>${esc(item.summary)}</p>
        <div class="diff-summary" style="white-space: pre-wrap;">${esc(item.draft)}</div>
        <div class="meta-block">
          <div><strong>Direction:</strong> ${esc(directionName(item.directionId) || "—")}</div>
          <div><strong>Drafted:</strong> ${esc(relativeTime(item.createdAt))}</div>
        </div>
        <div style="margin-top: 20px; display: flex; gap: 8px;">
          <button class="btn" data-reply-approve="${esc(item.id)}">✓ Approve &amp; Send</button>
          <button class="btn btn-secondary" data-reply-discard="${esc(item.id)}">✕ Discard</button>
        </div>
      </div>
    `;
  }

  function wireReplyPaneEvents(pane, item) {
    pane.querySelector("[data-reply-approve]")?.addEventListener("click", () => {
      approveReply(item.id);
      closeTab(`queue-${item.id}`);
    });
    pane.querySelector("[data-reply-discard]")?.addEventListener("click", () => {
      discardReply(item.id);
      closeTab(`queue-${item.id}`);
    });
  }

  function approveReply(id) {
    const item = state.queue.find((q) => q.id === id);
    if (!item) return;
    item.status = "sent";
    renderQueue();
    refreshPlanTabIfOpen();
    toast(`Sent reply: ${item.title}`);
  }

  function discardReply(id) {
    const item = state.queue.find((q) => q.id === id);
    if (!item) return;
    item.status = "discarded";
    renderQueue();
    refreshPlanTabIfOpen();
    toast(`Discarded: ${item.title}`);
  }

  // ── Outbox (your outgoing questions) ────────────────────────────────

  function renderOutboxTree() {
    const container = document.getElementById("tree-outbox");
    const open = state.outbox.filter((o) => o.status !== "sent");
    document.getElementById("outbox-count").textContent = open.length || "";

    if (open.length === 0) {
      container.innerHTML = `<div class="tree-empty-state">No pending questions.</div>`;
      return;
    }

    const readyCount = open.filter((o) => o.status === "ready").length;

    container.innerHTML =
      open
        .map(
          (o) => `
      <div class="outbox-item" data-outbox-id="${esc(o.id)}">
        <div class="outbox-item-to">to ${esc(o.to)}</div>
        <div class="outbox-item-question">${esc(o.question)}</div>
        <span class="outbox-verdict ${esc(o.aiCheck.verdict)}">${o.aiCheck.verdict === "likely-answerable-locally" ? "⚠ you may already know this" : "✓ worth asking"}</span>
      </div>
    `,
        )
        .join("") +
      (readyCount > 0
        ? `<div class="outbox-toolbar"><button class="btn btn-small" id="send-batch-btn">Send ${readyCount} ready question${readyCount === 1 ? "" : "s"} now</button></div>`
        : "");

    container.querySelectorAll("[data-outbox-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const o = state.outbox.find((x) => x.id === el.dataset.outboxId);
        if (o) openOutboxTab(o);
      });
    });

    container.querySelector("#send-batch-btn")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      sendReadyBatch();
    });
  }

  function openOutboxTab(o) {
    const tabId = `outbox-${o.id}`;
    openTab(tabId, `Q: ${o.to}`, () => `
      <div class="markdown-pane">
        <h1>Question for ${esc(o.to)}</h1>
        <p>${esc(o.question)}</p>
        <div class="review-notes">
          <strong>AI pre-check:</strong><br>${esc(o.aiCheck.note)}
        </div>
        <div class="meta-block">
          <div><strong>Status:</strong> ${esc(o.status)}</div>
          <div><strong>Raised:</strong> ${esc(relativeTime(o.createdAt))}</div>
        </div>
        <div style="margin-top: 20px; display: flex; gap: 8px;">
          <button class="btn" data-outbox-mark-ready="${esc(o.id)}" ${o.status === "ready" ? "disabled" : ""}>
            ${o.status === "ready" ? "✓ Ready to send" : "I still want to ask this"}
          </button>
          <button class="btn btn-secondary" data-outbox-drop="${esc(o.id)}">Drop this question</button>
        </div>
      </div>
    `, (pane) => {
      pane.querySelector("[data-outbox-mark-ready]")?.addEventListener("click", () => {
        o.status = "ready";
        renderOutboxTree();
        toast(`Marked ready: question for ${o.to}`);
        closeTab(tabId);
      });
      pane.querySelector("[data-outbox-drop]")?.addEventListener("click", () => {
        state.outbox = state.outbox.filter((x) => x.id !== o.id);
        renderOutboxTree();
        toast(`Dropped question for ${o.to} — AI pre-check saved you an interruption.`);
        closeTab(tabId);
      });
    });
  }

  function sendReadyBatch() {
    const ready = state.outbox.filter((o) => o.status === "ready");
    ready.forEach((o) => (o.status = "sent"));
    renderOutboxTree();
    toast(`Sent ${ready.length} question${ready.length === 1 ? "" : "s"} as a single batch.`);
  }

  // ── Tab management ───────────────────────────────────────────────────

  function openTab(tabId, title, renderHtml, afterRender) {
    if (!openTabs.has(tabId)) {
      openTabs.set(tabId, { title, renderHtml, afterRender });
      const tabBar = document.getElementById("tab-bar");
      const tabEl = document.createElement("div");
      tabEl.className = "tab";
      tabEl.dataset.tab = tabId;
      tabEl.innerHTML = `<span class="tab-icon">📄</span> ${esc(title)} <span class="tab-close" data-close="${esc(tabId)}">✕</span>`;
      tabBar.appendChild(tabEl);
      tabEl.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-close]")) return;
        activateTab(tabId);
      });
      tabEl.querySelector("[data-close]").addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeTab(tabId);
      });

      const editorContent = document.getElementById("editor-content");
      const pane = document.createElement("div");
      pane.className = "editor-pane";
      pane.id = `pane-${tabId}`;
      pane.innerHTML = renderHtml();
      editorContent.appendChild(pane);
      if (afterRender) afterRender(pane);
    } else {
      // refresh content in case underlying item changed
      const entry = openTabs.get(tabId);
      const pane = document.getElementById(`pane-${tabId}`);
      if (pane) {
        pane.innerHTML = renderHtml();
        if (afterRender) afterRender(pane);
      }
    }
    activateTab(tabId);
  }

  function activateTab(tabId) {
    activeTabId = tabId;
    document.querySelectorAll(".tab").forEach((el) => {
      el.classList.toggle("active", el.dataset.tab === tabId);
    });
    document.querySelectorAll(".editor-pane").forEach((el) => {
      el.classList.toggle("active", el.id === `pane-${tabId}`);
    });
  }

  function closeTab(tabId) {
    openTabs.delete(tabId);
    document.querySelector(`.tab[data-tab="${tabId}"]`)?.remove();
    document.getElementById(`pane-${tabId}`)?.remove();
    if (activeTabId === tabId) {
      const remaining = [...document.querySelectorAll(".tab")];
      activateTab(remaining.length ? remaining[remaining.length - 1].dataset.tab : "welcome");
    }
  }

  // ── Today's Plan (merged brief + queue snapshot) ────────────────────

  function renderPlan() {
    const open = openQueueItems();
    const escalations = open.filter((i) => i.kind === "escalation");
    const reviews = open.filter((i) => i.kind === "review").sort((a, b) => a.confidence - b.confidence);
    const replies = open.filter((i) => i.kind === "reply-draft");
    const activeDirections = state.directions.filter((d) => d.enabled);
    const pendingProposals = state.proposals.filter((p) => p.status === "pending");
    const readyQuestions = state.outbox.filter((o) => o.status === "ready");

    const itemRow = (item, extra) => `
      <div class="plan-item kind-${esc(item.kind)}">
        <span class="plan-item-icon">${KIND_ICON[item.kind] || "•"}</span>
        <div class="plan-item-body">
          <span class="plan-item-title" data-open-item="${esc(item.id)}">${esc(item.title)}</span>
          ${extra || ""}
        </div>
      </div>
    `;

    return `
      <div class="brief-pane">
        <h1>Today's Plan — ${esc(new Date().toISOString().slice(0, 10))}</h1>
        <p style="color: var(--fg-muted); margin-top: -8px;">
          This is your plan for the day and, as you work through it, the record of what happened.
          Escalations always come first. Everything else is ${esc(state.sortMode)}-ordered, same as the Work Queue.
        </p>

        ${escalations.length ? `
        <div class="brief-section">
          <h2 class="overdue">🔥 Needs you right now (${escalations.length})</h2>
          ${escalations.map((i) => itemRow(i, `<span class="brief-meta">${esc(i.source)}</span>`)).join("")}
        </div>` : ""}

        <div class="brief-section">
          <h2>🔍 AI work awaiting your review (${reviews.length})</h2>
          ${reviews.length
            ? reviews
                .map((i) =>
                  itemRow(
                    i,
                    `<span class="confidence-badge ${confidenceClass(i.confidence)}">conf ${i.confidence.toFixed(2)}</span>
                     <span class="brief-meta">${esc(relativeTime(i.escalateBy))}</span>`,
                  ),
                )
                .join("")
            : `<div class="brief-empty">Nothing to review — everything is proceeding on its own.</div>`}
        </div>

        <div class="brief-section">
          <h2>✉ Drafted replies awaiting approval (${replies.length})</h2>
          ${replies.length
            ? replies.map((i) => itemRow(i, `<span class="brief-meta">${esc(i.source)}</span>`)).join("")
            : `<div class="brief-empty">Nothing pending.</div>`}
        </div>

        <div class="brief-section">
          <h2>Your questions ready to send (${readyQuestions.length})</h2>
          ${readyQuestions.length
            ? `<ul class="brief-list">${readyQuestions.map((o) => `<li>to ${esc(o.to)}: ${esc(o.question)}</li>`).join("")}</ul>
               <button class="btn btn-small" id="plan-send-batch-btn" style="margin-top: 8px;">Send as a batch</button>`
            : `<div class="brief-empty">None held for batching.</div>`}
        </div>

        <div class="brief-section">
          <h2>Directions in effect (${activeDirections.length})</h2>
          <ul class="brief-list">${activeDirections.map((d) => `<li>${esc(d.name)} <span class="posture-tag">${esc(d.posture)}</span></li>`).join("")}</ul>
        </div>

        <div class="brief-section">
          <h2>Learning-loop proposals (${pendingProposals.length})</h2>
          ${pendingProposals.length
            ? pendingProposals
                .map(
                  (p) => `
            <div class="proposal-card">
              <div class="proposal-title">${esc(p.proposal.kind)}: ${esc(directionName(p.proposal.directionId))} → ${esc(p.proposal.field)} = ${esc(p.proposal.proposedValue)}</div>
              <div class="proposal-rationale">${esc(p.proposal.rationale)}</div>
              <div class="proposal-actions">
                <button class="btn btn-small" data-accept-proposal="${esc(p.eventId)}">Accept</button>
                <button class="btn btn-small btn-secondary" data-reject-proposal="${esc(p.eventId)}">Reject</button>
              </div>
            </div>
          `,
                )
                .join("")
            : `<div class="brief-empty">No pending proposals.</div>`}
        </div>
      </div>
    `;
  }

  function openPlanTab() {
    openTab("plan", "Today's Plan", renderPlan, (pane) => wirePlanEvents(pane));
  }

  function refreshPlanTabIfOpen() {
    const pane = document.getElementById("pane-plan");
    if (!pane) return;
    pane.innerHTML = renderPlan();
    wirePlanEvents(pane);
  }

  function wirePlanEvents(pane) {
    pane.querySelectorAll("[data-open-item]").forEach((el) => {
      el.addEventListener("click", () => {
        const item = state.queue.find((q) => q.id === el.dataset.openItem);
        if (item) openQueueItemTab(item);
      });
    });
    pane.querySelector("#plan-send-batch-btn")?.addEventListener("click", () => {
      sendReadyBatch();
      refreshPlanTabIfOpen();
    });
    pane.querySelectorAll("[data-accept-proposal]").forEach((btn) => {
      btn.addEventListener("click", () => resolveProposal(btn.dataset.acceptProposal, "accepted"));
    });
    pane.querySelectorAll("[data-reject-proposal]").forEach((btn) => {
      btn.addEventListener("click", () => resolveProposal(btn.dataset.rejectProposal, "rejected"));
    });
  }

  function resolveProposal(eventId, resolution) {
    const p = state.proposals.find((x) => x.eventId === eventId);
    if (!p) return;
    p.status = resolution;
    if (resolution === "accepted") {
      toast(`Accepted. In directions/${p.proposal.directionId}.yaml set ${p.proposal.field}: ${p.proposal.proposedValue}`);
    } else {
      toast("Proposal rejected.");
    }
    refreshPlanTabIfOpen();
  }

  // ── Status bar: pause/resume ─────────────────────────────────────────

  function renderPauseStatus() {
    const el = document.getElementById("pause-status-item");
    el.textContent = state.paused ? "▶ paused — click to resume" : "⏸ running — click to pause";
  }

  function togglePause() {
    state.paused = !state.paused;
    renderPauseStatus();
    toast(state.paused ? "mind: sends paused." : "mind: sends resumed.");
  }

  // ── Status bar: AI provider QuickPick ────────────────────────────────

  const PROVIDER_CHOICES = [
    { provider: "ollama", label: "Ollama (local)", description: "Free, runs on this machine, no data leaves the device", defaultModel: "qwen2.5:3b-instruct" },
    { provider: "openai", label: "OpenAI", description: "Cloud — requires an API key", defaultModel: "gpt-4o-mini" },
    { provider: "anthropic", label: "Anthropic", description: "Cloud — requires an API key", defaultModel: "claude-haiku-4-5" },
    { provider: "google", label: "Google", description: "Cloud — requires an API key", defaultModel: "gemini-2.0-flash" },
  ];

  function renderAiStatus() {
    const el = document.getElementById("ai-status-item");
    const icon = state.aiProvider === "ollama" ? "🖥" : "☁";
    el.textContent = `${icon} ${state.aiProvider}`;
  }

  function openAiProviderPicker() {
    const overlay = document.getElementById("command-palette-overlay");
    const list = document.getElementById("ai-provider-list");
    const input = document.getElementById("ai-provider-search");

    function renderList(filter) {
      const f = (filter || "").toLowerCase();
      const items = PROVIDER_CHOICES.filter(
        (c) => c.label.toLowerCase().includes(f) || c.provider.includes(f),
      );
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
          renderAiStatus();
          closePicker();
          toast(
            `mind: AI provider set to ${el.dataset.provider} (${el.dataset.model}). Takes effect on the next signal — no restart needed.`,
          );
        });
      });
    }

    function closePicker() {
      overlay.classList.add("hidden");
      input.removeEventListener("input", onInput);
      document.removeEventListener("keydown", onKeydown);
    }

    function onInput() {
      renderList(input.value);
    }

    function onKeydown(ev) {
      if (ev.key === "Escape") closePicker();
    }

    input.value = "";
    renderList("");
    overlay.classList.remove("hidden");
    input.focus();
    input.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeydown);

    overlay.addEventListener(
      "click",
      (ev) => {
        if (ev.target === overlay) closePicker();
      },
      { once: true },
    );
  }

  // ── Sort toggle ──────────────────────────────────────────────────────

  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sortMode = btn.dataset.sort;
      document.querySelectorAll(".sort-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderQueue();
      refreshPlanTabIfOpen();
    });
  });

  // ── Tree collapse (outbox only now) ──────────────────────────────────

  document.querySelectorAll("[data-collapse-target]").forEach((header) => {
    header.addEventListener("click", () => {
      const body = document.getElementById(header.dataset.collapseTarget);
      header.classList.toggle("collapsed");
      body.classList.toggle("collapsed");
    });
  });

  // ── Wire top-level controls ──────────────────────────────────────────

  document.getElementById("open-brief-btn").addEventListener("click", openPlanTab);
  document.getElementById("pause-status-item").addEventListener("click", togglePause);
  document.getElementById("ai-status-item").addEventListener("click", openAiProviderPicker);

  document.querySelectorAll(".activity-icon").forEach((icon) => {
    icon.addEventListener("click", () => {
      if (icon.dataset.view !== "explorer") {
        toast(`"${icon.dataset.view}" is not part of this mockup.`);
        return;
      }
      document.querySelectorAll(".activity-icon").forEach((i) => i.classList.remove("active"));
      icon.classList.add("active");
    });
  });

  // ── Initial render ───────────────────────────────────────────────────

  renderQueue();
  renderOutboxTree();
  renderPauseStatus();
  renderAiStatus();
})();
