/**
 * Interactive mockup of the mind VS Code extension.
 * All state lives in window.MOCK_STATE (see data.js) and is mutated directly —
 * this is a UI mockup, not a client for the real server. See extension/src/
 * for the real implementation this mirrors.
 */

(function () {
  "use strict";

  const state = window.MOCK_STATE;
  const openTabs = new Map(); // tabId -> { title, render() }
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

  // ── Thoughts tree ────────────────────────────────────────────────────

  const STATE_ORDER = { active: 0, seedling: 1, parked: 2, closed: 3 };
  const STATE_ICON = { active: "🔥", seedling: "🌱", parked: "⏸", closed: "✓" };

  function renderThoughtsTree() {
    const container = document.getElementById("tree-thoughts");
    const sorted = [...state.thoughts].sort(
      (a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9),
    );

    document.getElementById("thoughts-count").textContent =
      state.thoughts.filter((t) => t.state !== "closed").length || "";

    if (sorted.length === 0) {
      container.innerHTML = `<div class="tree-empty-state">No thoughts.</div>`;
      return;
    }

    container.innerHTML = sorted
      .map(
        (t) => `
      <div class="tree-item" data-thought-id="${esc(t.id)}" title="${esc(t.nextAction || "")}">
        <span class="tree-item-icon">${STATE_ICON[t.state] || "•"}</span>
        <span class="tree-item-label state-${esc(t.state)}">${esc(t.title)}</span>
        <span class="tree-item-desc">${esc(t.state)}</span>
      </div>
    `,
      )
      .join("");

    container.querySelectorAll("[data-thought-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const thought = state.thoughts.find((t) => t.id === el.dataset.thoughtId);
        if (thought) openThoughtTab(thought);
      });
    });
  }

  function openThoughtTab(thought) {
    const tabId = `thought-${thought.id}`;
    openTab(tabId, thought.title, () => `
      <div class="markdown-pane">
        <h1>${esc(thought.title)}</h1>
        <p>${esc(thought.body)}</p>
        <div class="meta-block">
          <div><strong>State:</strong> ${esc(thought.state)}</div>
          <div><strong>Direction:</strong> ${esc(directionName(thought.directionId) || "—")}</div>
          <div><strong>Next action:</strong> ${esc(thought.nextAction || "—")}</div>
          <div><strong>Escalate by:</strong> ${thought.escalateBy ? esc(relativeTime(thought.escalateBy)) : "—"}</div>
          <div><strong>Review at:</strong> ${thought.reviewAt ? esc(relativeTime(thought.reviewAt)) : "—"}</div>
        </div>
      </div>
    `);
  }

  // ── Review tree ──────────────────────────────────────────────────────

  function renderReviewTree() {
    const container = document.getElementById("tree-review");
    const proposed = state.actions.filter((a) => a.status === "proposed");

    document.getElementById("review-count").textContent = proposed.length || "";

    if (proposed.length === 0) {
      container.innerHTML = `<div class="tree-empty-state">Nothing waiting for review.</div>`;
      return;
    }

    container.innerHTML = proposed
      .map((a) => {
        const preview = a.payload.body.slice(0, 48) + (a.payload.body.length > 48 ? "…" : "");
        return `
        <div class="tree-item" data-action-id="${esc(a.id)}">
          <span class="tree-item-icon">✉</span>
          <span class="tree-item-label">[${esc(a.adapter)}] ${esc(preview)}</span>
          <div class="tree-item-actions">
            <button class="tree-item-action-btn approve" data-approve="${esc(a.id)}" title="Approve & Send">✓</button>
            <button class="tree-item-action-btn discard" data-discard="${esc(a.id)}" title="Discard">✕</button>
          </div>
        </div>
      `;
      })
      .join("");

    container.querySelectorAll("[data-action-id]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-approve],[data-discard]")) return;
        const action = state.actions.find((a) => a.id === el.dataset.actionId);
        if (action) openActionTab(action);
      });
    });

    container.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        approveAction(btn.dataset.approve);
      });
    });

    container.querySelectorAll("[data-discard]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        discardAction(btn.dataset.discard);
      });
    });
  }

  function openActionTab(action) {
    const tabId = `action-${action.id}`;
    openTab(tabId, `Review: ${action.signalFrom}`, () => `
      <div class="markdown-pane">
        <h1>Proposed reply to ${esc(action.signalFrom)}</h1>
        <p>${esc(action.payload.body)}</p>
        <div class="meta-block">
          <div><strong>Direction:</strong> ${esc(directionName(action.directionId) || "—")}</div>
          <div><strong>Adapter:</strong> ${esc(action.adapter)}</div>
          <div><strong>Created:</strong> ${esc(relativeTime(action.createdAt))}</div>
        </div>
        <div style="margin-top: 20px; display: flex; gap: 8px;">
          <button class="btn" data-tab-approve="${esc(action.id)}">✓ Approve &amp; Send</button>
          <button class="btn btn-secondary" data-tab-discard="${esc(action.id)}">✕ Discard</button>
        </div>
      </div>
    `, (pane) => {
      pane.querySelector(`[data-tab-approve]`)?.addEventListener("click", () => {
        approveAction(action.id);
        closeTab(tabId);
      });
      pane.querySelector(`[data-tab-discard]`)?.addEventListener("click", () => {
        discardAction(action.id);
        closeTab(tabId);
      });
    });
  }

  function approveAction(id) {
    const action = state.actions.find((a) => a.id === id);
    if (!action) return;
    action.status = "sent";
    renderReviewTree();
    renderThoughtsTree();
    toast(`Sent reply to ${action.signalFrom}`);
  }

  function discardAction(id) {
    const action = state.actions.find((a) => a.id === id);
    if (!action) return;
    action.status = "discarded";
    renderReviewTree();
    renderThoughtsTree();
    toast(`Discarded draft to ${action.signalFrom}`);
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

  // ── Today Brief ──────────────────────────────────────────────────────

  function renderBrief() {
    const active = state.thoughts.filter((t) => t.state === "active");
    const overdue = state.thoughts.filter(
      (t) => t.state === "seedling" && t.escalateBy && new Date(t.escalateBy) <= new Date(),
    );
    const newToday = state.thoughts.filter(
      (t) =>
        t.state === "seedling" &&
        !(t.escalateBy && new Date(t.escalateBy) <= new Date()) &&
        new Date(t.createdAt) > new Date(Date.now() - 24 * 3600_000),
    );
    const reviewDue = state.thoughts.filter((t) => t.reviewAt && new Date(t.reviewAt) <= new Date());
    const proposed = state.actions.filter((a) => a.status === "proposed");
    const activeDirections = state.directions.filter((d) => d.enabled);

    const listOrEmpty = (items, render) =>
      items.length
        ? `<ul class="brief-list">${items.map(render).join("")}</ul>`
        : `<div class="brief-empty">Nothing here.</div>`;

    return `
      <div class="brief-pane">
        <h1>Today — ${esc(new Date().toISOString().slice(0, 10))}</h1>

        <div class="brief-section">
          <h2>Directions in effect (${activeDirections.length})</h2>
          ${listOrEmpty(activeDirections, (d) => `
            <li>${esc(d.name)} <span class="posture-tag">${esc(d.posture)}</span></li>
          `)}
        </div>

        ${overdue.length ? `
        <div class="brief-section">
          <h2 class="overdue">Overdue — response expected (${overdue.length})</h2>
          ${listOrEmpty(overdue, (t) => `
            <li><strong>${esc(t.title)}</strong><span class="brief-meta">escalate ${esc(relativeTime(t.escalateBy))}</span></li>
          `)}
        </div>` : ""}

        <div class="brief-section">
          <h2>Active thoughts (${active.length})</h2>
          ${listOrEmpty(active, (t) => `<li>${esc(t.title)}</li>`)}
        </div>

        ${newToday.length ? `
        <div class="brief-section">
          <h2>New today (${newToday.length})</h2>
          ${listOrEmpty(newToday, (t) => `<li>${esc(t.title)}</li>`)}
        </div>` : ""}

        ${reviewDue.length ? `
        <div class="brief-section">
          <h2>Review due (${reviewDue.length})</h2>
          ${listOrEmpty(reviewDue, (t) => `
            <li>${esc(t.title)}<span class="brief-meta">review ${esc(relativeTime(t.reviewAt))}</span></li>
          `)}
        </div>` : ""}

        <div class="brief-section">
          <h2>Awaiting your approval (${proposed.length})</h2>
          ${proposed.length
            ? `<p><a href="#" id="brief-open-review">open Review panel</a></p>`
            : `<div class="brief-empty">Nothing pending.</div>`}
        </div>

        <div class="brief-section">
          <h2>Learning-loop proposals (${state.proposals.filter((p) => p.status === "pending").length})</h2>
          ${state.proposals
            .filter((p) => p.status === "pending")
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
            .join("") || `<div class="brief-empty">No pending proposals.</div>`}
        </div>
      </div>
    `;
  }

  function openBriefTab() {
    openTab(
      "brief",
      "Today — mind",
      renderBrief,
      (pane) => wireBriefEvents(pane),
    );
  }

  function refreshBriefTabIfOpen() {
    const pane = document.getElementById("pane-brief");
    if (!pane) return;
    pane.innerHTML = renderBrief();
    wireBriefEvents(pane);
  }

  function wireBriefEvents(pane) {
    pane.querySelector("#brief-open-review")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      document.querySelector('[data-collapse-target="tree-review"]')?.scrollIntoView({ behavior: "smooth" });
      toast("Switched focus to the Review panel");
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
      const dir = state.directions.find((d) => d.id === p.proposal.directionId);
      toast(
        `Accepted. In directions/${p.proposal.directionId}.yaml set ${p.proposal.field}: ${p.proposal.proposedValue}`,
      );
    } else {
      toast("Proposal rejected.");
    }
    refreshBriefTabIfOpen();
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

  // ── Tree collapse ────────────────────────────────────────────────────

  document.querySelectorAll("[data-collapse-target]").forEach((header) => {
    header.addEventListener("click", () => {
      const body = document.getElementById(header.dataset.collapseTarget);
      header.classList.toggle("collapsed");
      body.classList.toggle("collapsed");
    });
  });

  // ── Wire top-level controls ──────────────────────────────────────────

  document.getElementById("open-brief-btn").addEventListener("click", openBriefTab);
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

  renderThoughtsTree();
  renderReviewTree();
  renderPauseStatus();
  renderAiStatus();
})();
