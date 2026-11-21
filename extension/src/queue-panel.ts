import * as vscode from "vscode";
import { apiFetch, apiFetchBytes } from "./api-client.js";
import { ago, channelLabel, timingLabel } from "./format.js";
import {
  canMoveUnder,
  type Goal,
  goalFlags,
  goalTree,
  itemsForGoal,
  sortGoals,
  unlinkedItems,
} from "./goals.js";
import { type QueueItem, runItemAction } from "./queue-actions.js";
import { itemSearchText } from "./queue-search.js";
import {
  addDays,
  dueUnplanned,
  groupByDate,
  inView,
  localDate,
  nextMonday,
  parsePlanDate,
  planLabel,
  planState,
  type QueueView,
  VIEWS,
  viewCounts,
} from "./queue-view.js";
import { esc, SectionPanel } from "./webview-base.js";

const QUEUE_STYLE = `
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 12px; }
  .tab.active { background: var(--mind-accent); color: var(--mind-accent-fg); border-color: transparent; }
  .tab .count { opacity: 0.8; margin-left: 6px; font-size: 0.9em; }
  .tab.drop-over { outline: 2px dashed var(--mind-accent); outline-offset: 2px; }
  .up-next { border-left: 3px solid var(--mind-accent); }
  .plan-chip { font-size: 0.85em; padding: 1px 8px; border-radius: 10px; background: var(--mind-row-alt); }
  .plan-chip.overdue { color: var(--mind-yellow); }
  .group-title { margin: 14px 0 6px; font-weight: 600; }
  .queue-item { cursor: grab; }
  .queue-item.dragging { opacity: 0.45; }
  .queue-item.selected { outline: 2px solid var(--mind-accent); outline-offset: -2px; background: color-mix(in srgb, var(--mind-accent) 12%, var(--vscode-editor-background)); }
  .item-line { user-select: none; }
  #selbar { position: sticky; top: 0; z-index: 3; padding: 6px 8px; margin: 0 0 8px; border-radius: 6px; background: var(--vscode-editor-background); border: 1px solid var(--mind-accent); }
  .queue-item .handle { opacity: 0.5; margin-right: 6px; user-select: none; }
  .queue-item:focus-visible { outline: 2px solid var(--mind-accent); outline-offset: 2px; }
  .timing { font-size: 0.85em; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; white-space: nowrap; }
  .timing.now { color: var(--mind-red); }
  .timing.today { color: var(--mind-yellow); }
  .timing.this-week { color: var(--mind-accent); }
  .timing.can-wait { color: var(--vscode-descriptionForeground, inherit); }
  /* The page does not scroll; each column does, so a long goal list and a long signal list never move together. */
  body { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  /* Use the whole panel width; the shared page style caps it for reading-width pages. */
  html body { max-width: none; margin: 0; }
  .queue-cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(300px, 1fr) minmax(360px, 1fr); gap: 20px; }
  .queue-cols > section { min-height: 0; overflow-y: auto; padding-right: 6px; }
  @media (max-width: 760px) { .queue-cols { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; } }
  .search { display: flex; gap: 6px; margin: 0 0 8px; }
  .search input { flex: 1; min-width: 0; }
  .group-title[hidden], .queue-item[hidden], .empty[hidden] { display: none; }
  .col-title { margin: 0 0 8px; font-weight: 600; }
  .goal-card { border-left: 3px solid var(--mind-purple); }
  .goal-card.drop-over { outline: 2px dashed var(--mind-accent); outline-offset: 2px; background: color-mix(in srgb, var(--mind-accent) 10%, transparent); }
  .goal-card .queue-item { margin-left: 10px; }
  .goal-card[draggable="true"] { cursor: grab; }
  .goal-card.dragging { opacity: 0.45; }
  .col-title.drop-over { outline: 2px dashed var(--mind-accent); outline-offset: 2px; }
  .linked[hidden] { display: none; }
  .linked-toggle { margin: 4px 0 0; }
  .goal-card.sub { border-left-color: var(--mind-accent); }
  .new-goal { display: flex; gap: 6px; margin: 0 0 10px; }
  .new-goal input { flex: 1; min-width: 0; }
  .queue-item.card { padding: 6px 10px; margin: 4px 0; }
  .item-line { display: flex; gap: 8px; align-items: center; justify-content: space-between; cursor: pointer; }
  .item-line .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .summary-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.85; }
  .queue-item .body { display: none; margin-top: 6px; }
  .queue-item.open .body { display: block; }
  .strip { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 0 0 12px; }
  #transcript { white-space: pre-wrap; margin: 6px 0; padding: 8px 10px; background: var(--mind-row-alt); border-radius: 4px; }
  #audio-box audio { width: 100%; max-width: 480px; }
  .flag { font-size: 0.85em; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; }
  .flag.overdue { color: var(--mind-red); }
  .flag.review { color: var(--mind-yellow); }
  .draft-preview { margin-top: 4px; padding-left: 8px; border-left: 3px solid var(--vscode-textBlockQuote-border, #888); opacity: 0.85; }
`;

/**
 * Drag to reorder: the card under the pointer is moved in the DOM as you
 * drag, and the full id order is posted on drop. Alt+Up / Alt+Down moves a
 * focused card for keyboard use. The extension saves the order and does not
 * re-render, so the list does not jump.
 */
const QUEUE_SCRIPT = `
(function () {
  // Selection follows the usual list conventions: Ctrl/Cmd+click toggles one
  // card, Shift+click selects everything between the last clicked card and this
  // one (added to the selection when Ctrl/Cmd is also held), and a plain click
  // clears the selection and expands or collapses the card.
  var selected = {};
  var anchor = null;
  function cards() {
    var l = document.getElementById('queue-list');
    return l ? Array.prototype.slice.call(l.querySelectorAll('.queue-item')) : [];
  }
  function visibleCards() { return cards().filter(function (c) { return !c.hidden; }); }
  function selectedIds() {
    return cards().filter(function (c) { return selected[c.dataset.itemId]; }).map(function (c) { return c.dataset.itemId; });
  }
  function paint() {
    var n = 0;
    cards().forEach(function (c) {
      var on = !!selected[c.dataset.itemId];
      c.classList.toggle('selected', on);
      if (on) n++;
    });
    var bar = document.getElementById('selbar');
    if (bar) {
      bar.hidden = n === 0;
      document.getElementById('selcount').textContent = n + ' selected';
    }
  }
  function clearSelection() { selected = {}; paint(); }
  document.addEventListener('mousedown', function (e) {
    if (e.shiftKey && e.target.closest && e.target.closest('.item-line')) e.preventDefault();
  });
  document.addEventListener('click', function (e) {
    var line = e.target.closest && e.target.closest('.item-line');
    if (!line) return;
    var card = line.parentElement;
    var id = card.dataset.itemId;
    var all = visibleCards();
    var index = all.indexOf(card);
    if (index < 0) { card.classList.toggle('open'); return; }
    var additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      var from = anchor === null ? -1 : all.findIndex(function (c) { return c.dataset.itemId === anchor; });
      if (from < 0) from = index;
      if (!additive) selected = {};
      for (var i = Math.min(from, index); i <= Math.max(from, index); i++) selected[all[i].dataset.itemId] = true;
    } else if (additive) {
      if (selected[id]) delete selected[id]; else selected[id] = true;
      anchor = id;
    } else {
      selected = {};
      anchor = id;
      card.classList.toggle('open');
    }
    paint();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') clearSelection();
  });
  [['sel-today', 'today'], ['sel-tomorrow', 'tomorrow'], ['sel-backlog', 'backlog']].forEach(function (pair) {
    var b = document.getElementById(pair[0]);
    if (b) b.addEventListener('click', function () { post({ command: 'plan', items: selectedIds(), when: pair[1] }); });
  });
  var clearButton = document.getElementById('sel-clear');
  if (clearButton) clearButton.addEventListener('click', clearSelection);
  var goalPicker = document.getElementById('sel-goal');
  if (goalPicker) goalPicker.addEventListener('change', function () {
    if (goalPicker.value) post({ command: 'link', items: selectedIds(), goal: goalPicker.value });
    goalPicker.value = '';
  });
  // Search: every word must appear in the card's data-search text, which holds
  // the attributes the card shows. Filtering is local, so typing never reloads.
  var searchInput = document.getElementById('signal-search');
  function applySearch() {
    var words = (searchInput ? searchInput.value : '').toLowerCase().split(/\\s+/).filter(Boolean);
    var shown = 0;
    cards().forEach(function (c) {
      var hay = c.getAttribute('data-search') || '';
      var match = words.every(function (w) { return hay.indexOf(w) >= 0; });
      c.hidden = !match;
      if (match) shown++; else delete selected[c.dataset.itemId];
    });
    // A day heading is hidden when every card under it is.
    var list = document.getElementById('queue-list');
    if (list) {
      var heading = null, any = false;
      Array.prototype.forEach.call(list.children, function (el) {
        if (el.classList.contains('group-title')) {
          if (heading) heading.hidden = !any;
          heading = el; any = false;
        } else if (!el.hidden) any = true;
      });
      if (heading) heading.hidden = !any;
    }
    var count = document.getElementById('shown-count');
    if (count) count.textContent = words.length ? shown + ' match' + (shown === 1 ? '' : 'es') : shown + ' awaiting action';
    var none = document.getElementById('no-match');
    if (none) none.hidden = !(words.length && shown === 0 && cards().length > 0);
    paint();
  }
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      applySearch();
      post({ command: 'search', text: searchInput.value });
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        applySearch();
        post({ command: 'search', text: '' });
        e.stopPropagation();
      }
    });
    applySearch();
  }
  var goalInput = document.getElementById('new-goal');
  if (goalInput) goalInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && goalInput.value.trim()) {
      post({ command: 'newGoal', text: goalInput.value });
      goalInput.value = '';
    }
  });
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    var status = document.getElementById('audio-status');
    if (m.type === 'transcript') {
      document.getElementById('transcript').textContent = m.text;
      document.getElementById('transcript-box').hidden = false;
    } else if (m.type === 'audioStatus') {
      status.textContent = m.text;
    } else if (m.type === 'audio') {
      var box = document.getElementById('audio-box');
      box.textContent = '';
      var a = document.createElement('audio');
      a.controls = true;
      a.src = m.src;
      box.appendChild(a);
      status.textContent = m.text;
      a.play().catch(function () {});
    }
  });
  var list = document.getElementById('queue-list');
  if (!list) return;
  var dragged = null;
  var dragIds = [];
  var droppedOnTab = false;
  var draggedGoal = null;

  // Linked records are hidden under their goal until asked for. The choice is
  // remembered by the extension so a refresh keeps it.
  document.querySelectorAll('[data-toggle-linked]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var goalId = btn.getAttribute('data-toggle-linked');
      var box = btn.parentElement.querySelector('.linked');
      if (!box) return;
      box.hidden = !box.hidden;
      btn.textContent = box.hidden ? 'Show linked' : 'Hide linked';
      post({ command: 'linkedOpen', goal: goalId, open: !box.hidden });
    });
  });

  // Dragging a goal card onto another goal makes it a sub-goal; dropping it on
  // the "Goals" heading makes it top-level. The extension rejects cycles.
  document.querySelectorAll('.goal-card[draggable="true"]').forEach(function (card) {
    card.addEventListener('dragstart', function (e) {
      if (e.target !== card) return;
      draggedGoal = card.getAttribute('data-goal');
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedGoal);
    });
    card.addEventListener('dragend', function () {
      draggedGoal = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.drop-over').forEach(function (el) { el.classList.remove('drop-over'); });
    });
  });
  var goalRoot = document.querySelector('[data-goal-root]');
  if (goalRoot) {
    goalRoot.addEventListener('dragover', function (e) {
      if (!draggedGoal) return;
      e.preventDefault();
      goalRoot.classList.add('drop-over');
    });
    goalRoot.addEventListener('dragleave', function () { goalRoot.classList.remove('drop-over'); });
    goalRoot.addEventListener('drop', function (e) {
      if (!draggedGoal) return;
      e.preventDefault();
      goalRoot.classList.remove('drop-over');
      post({ command: 'moveGoal', goal: draggedGoal, parent: null });
    });
  }

  document.querySelectorAll('[data-drop]').forEach(function (tab) {
    tab.addEventListener('dragover', function (e) {
      if (!dragged) return;
      e.preventDefault();
      tab.classList.add('drop-over');
    });
    tab.addEventListener('dragleave', function () { tab.classList.remove('drop-over'); });
    tab.addEventListener('drop', function (e) {
      if (!dragged) return;
      e.preventDefault();
      tab.classList.remove('drop-over');
      droppedOnTab = true;
      post({ command: 'plan', items: dragIds, when: tab.getAttribute('data-drop') });
    });
  });

  document.querySelectorAll('[data-goal]').forEach(function (goal) {
    goal.addEventListener('dragover', function (e) {
      if (!dragged && !draggedGoal) return;
      if (draggedGoal === goal.getAttribute('data-goal')) return;
      e.preventDefault();
      goal.classList.add('drop-over');
    });
    goal.addEventListener('dragleave', function (e) {
      if (!goal.contains(e.relatedTarget)) goal.classList.remove('drop-over');
    });
    goal.addEventListener('drop', function (e) {
      if (draggedGoal) {
        e.preventDefault();
        goal.classList.remove('drop-over');
        post({ command: 'moveGoal', goal: draggedGoal, parent: goal.getAttribute('data-goal') });
        return;
      }
      if (!dragged) return;
      e.preventDefault();
      goal.classList.remove('drop-over');
      droppedOnTab = true;
      post({ command: 'link', items: dragIds, goal: goal.getAttribute('data-goal') });
    });
  });

  function ids() {
    return Array.prototype.map.call(list.querySelectorAll('.queue-item'), function (c) { return c.dataset.itemId; });
  }
  function save() { post({ command: 'reorder', ids: ids() }); }

  function cardAfter(y) {
    var cards = Array.prototype.filter.call(list.querySelectorAll('.queue-item'), function (c) { return c !== dragged; });
    var best = null, bestOffset = Number.NEGATIVE_INFINITY;
    cards.forEach(function (c) {
      var box = c.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > bestOffset) { bestOffset = offset; best = c; }
    });
    return best;
  }

  list.addEventListener('dragstart', function (e) {
    var card = e.target.closest && e.target.closest('.queue-item');
    if (!card) return;
    dragged = card;
    // Dragging a selected card carries the whole selection; dragging any other card drags just that one.
    if (selected[card.dataset.itemId] && selectedIds().length > 1) dragIds = selectedIds();
    else { selected = {}; paint(); dragIds = [card.dataset.itemId]; }
    cards().forEach(function (c) { if (dragIds.indexOf(c.dataset.itemId) >= 0) c.classList.add('dragging'); });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragIds.join(','));
  });
  list.addEventListener('dragover', function (e) {
    // Reordering moves one card; a multi-card drag only makes sense onto a goal or a tab.
    if (!dragged || dragIds.length !== 1) return;
    e.preventDefault();
    var after = cardAfter(e.clientY);
    if (after) list.insertBefore(dragged, after); else list.appendChild(dragged);
  });
  list.addEventListener('drop', function (e) { if (dragged) e.preventDefault(); });
  list.addEventListener('dragend', function () {
    if (!dragged) return;
    cards().forEach(function (c) { c.classList.remove('dragging'); });
    var single = dragIds.length === 1;
    dragged = null;
    dragIds = [];
    if (droppedOnTab) { droppedOnTab = false; return; }
    if (single) save();
  });

  list.addEventListener('keydown', function (e) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    var card = e.target.closest && e.target.closest('.queue-item');
    if (!card || e.target !== card) return;
    e.preventDefault();
    var sibling = e.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling) return;
    if (e.key === 'ArrowUp') list.insertBefore(card, sibling); else list.insertBefore(sibling, card);
    card.focus();
    save();
  });
})();
`;

/**
 * Queue — plan the work, then do it. Every item is either planned for a day
 * or in the backlog. Today is the working list: what you planned for today
 * plus anything carried over. Each item shows when it needs you (and why) and
 * offers the actions that fit it. Drag cards to reorder, or drop one on the
 * Today or Backlog tab to plan it.
 */
export class QueuePanel extends SectionPanel {
  private static current: QueuePanel | undefined;
  /** Remembered between reopenings of the panel. */
  private static view: QueueView = "today";
  /** The signal search text, remembered so a refresh does not clear it. */
  private static search = "";
  /** Goals whose linked records are shown; the rest keep them hidden. */
  private static openGoals = new Set<string>();
  private items: QueueItem[] = [];
  private goals: Goal[] = [];
  private summary: { absorbedToday: number } = { absorbedToday: 0 };
  private loadError: string | undefined;

  static show(): void {
    if (QueuePanel.current) {
      QueuePanel.current.reveal();
      QueuePanel.current.load();
      return;
    }
    QueuePanel.current = new QueuePanel();
  }

  /** Called by other panels after they change queue state. */
  static refreshIfOpen(): void {
    QueuePanel.current?.load();
  }

  private constructor() {
    super("mind.queue", "Queue — mind");
    this.load();
  }

  protected onDispose(): void {
    QueuePanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as {
      command?: string;
      item?: string;
      act?: string;
      ids?: unknown;
      id?: string;
      view?: string;
      when?: string;
      goal?: string;
      parent?: string | null;
      open?: boolean;
      text?: string;
      state?: string;
      items?: unknown;
    };
    const itemIds = Array.isArray(m.items)
      ? m.items.filter((v): v is string => typeof v === "string")
      : m.item
        ? [m.item]
        : [];
    if (m.command === "refresh") this.load();
    else if (m.command === "search") QueuePanel.search = (m.text ?? "").slice(0, 200);
    else if (m.command === "newSubGoal" && m.goal) void this.newSubGoal(m.goal);
    else if (m.command === "renameGoal" && m.goal) void this.renameGoal(m.goal);
    else if (m.command === "moveGoal" && m.goal && m.parent !== undefined) {
      void this.moveGoal(m.goal, m.parent);
    } else if (m.command === "linkedOpen" && m.goal) {
      if (m.open) QueuePanel.openGoals.add(m.goal);
      else QueuePanel.openGoals.delete(m.goal);
    } else if (m.command === "view" && VIEWS.some((v) => v.id === m.view)) {
      QueuePanel.view = m.view as QueueView;
      this.load();
    } else if (m.command === "plan" && itemIds.length > 0 && m.when) this.plan(itemIds, m.when);
    else if (m.command === "planDue") this.planDue();
    else if (m.command === "itemAction" && m.item && m.act) this.runAction(m.item, m.act);
    else if (m.command === "details" && m.item) {
      vscode.commands.executeCommand("mind.queue.item", m.item);
    } else if (m.command === "open" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    } else if (m.command === "link" && itemIds.length > 0 && m.goal) {
      void this.link(itemIds, m.goal);
    } else if (m.command === "unlink" && itemIds.length > 0) {
      void this.link(itemIds, null);
    } else if (m.command === "newGoal" && m.text?.trim()) {
      void this.newGoal(m.text.trim());
    } else if (
      m.command === "goalState" &&
      m.goal &&
      (m.state === "closed" || m.state === "parked")
    ) {
      void this.setGoalState(m.goal, m.state);
    } else if (m.command === "transcript") {
      void this.showTranscript();
    } else if (m.command === "audio") {
      void this.playAudio();
    } else if (m.command === "reorder" && Array.isArray(m.ids)) {
      this.saveOrder(m.ids.filter((v): v is string => typeof v === "string"));
    }
  }

  private async load(): Promise<void> {
    try {
      const [items, goals, summary] = await Promise.all([
        apiFetch<QueueItem[]>("/queue"),
        apiFetch<Goal[]>("/thoughts?state=goal"),
        apiFetch<{ absorbedToday: number }>("/summary"),
      ]);
      this.items = items;
      this.goals = goals;
      this.summary = summary;
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async runAction(itemId: string, actionId: string): Promise<void> {
    // Look the action up from loaded data; the webview only supplies ids.
    const item = this.items.find((i) => i.id === itemId);
    const action = item?.actions.find((a) => a.id === actionId);
    if (!item || !action) return;
    if (await runItemAction(item, action)) this.load();
  }

  /** Plans items: "today", "tomorrow", "backlog", or "choose" to pick a date (one item only). */
  private async plan(requested: string[], when: string): Promise<void> {
    const ids = requested.filter((id) => this.items.some((i) => i.id === id));
    if (ids.length === 0 || (when === "choose" && ids.length > 1)) return;
    const today = localDate();
    let date: string | null | undefined;
    if (when === "today") date = today;
    else if (when === "tomorrow") date = addDays(today, 1);
    else if (when === "backlog") date = null;
    else if (when === "choose") date = await this.pickDate(today);
    if (date === undefined) return;
    await this.savePlan(ids, date);
  }

  /** Plans every unplanned item that is already due, for today. */
  private async planDue(): Promise<void> {
    const today = localDate();
    const ids = dueUnplanned(this.items, today).map((i) => i.id);
    if (ids.length > 0) await this.savePlan(ids, today);
  }

  /** undefined = cancelled, null = backlog, otherwise a date. */
  private async pickDate(today: string): Promise<string | null | undefined> {
    const fmt = (d: string) => planLabel(d, today);
    const choices: Array<{ label: string; description?: string; date: string | null | "custom" }> =
      [
        { label: "Today", description: today, date: today },
        { label: "Tomorrow", description: addDays(today, 1), date: addDays(today, 1) },
        { label: "Next Monday", description: fmt(nextMonday(today)), date: nextMonday(today) },
        { label: "In a week", description: fmt(addDays(today, 7)), date: addDays(today, 7) },
        { label: "Pick a date…", date: "custom" },
        { label: "Backlog", description: "no plan", date: null },
      ];
    const picked = await vscode.window.showQuickPick(choices, { placeHolder: "Plan this for…" });
    if (!picked) return undefined;
    if (picked.date !== "custom") return picked.date;
    const typed = await vscode.window.showInputBox({
      prompt: "Date to deal with this (YYYY-MM-DD)",
      value: addDays(today, 2),
      validateInput: (v) =>
        parsePlanDate(v, today) ? undefined : "Enter a real date, today or later: YYYY-MM-DD",
    });
    return typed === undefined ? undefined : parsePlanDate(typed, today);
  }

  private async savePlan(ids: string[], date: string | null): Promise<void> {
    try {
      await apiFetch("/queue/plan", { method: "PUT", body: JSON.stringify({ ids, date }) });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not save the plan. ${String(err)}`);
    }
    this.load();
  }

  private async saveOrder(ids: string[]): Promise<void> {
    // `ids` are the items in the current view, in their new order. The server
    // puts them back into the slots they occupied; other items are untouched.
    try {
      await apiFetch("/queue/order", { method: "PUT", body: JSON.stringify({ ids }) });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not save the order. ${String(err)}`);
      this.load();
    }
  }

  private async link(requested: string[], goalId: string | null): Promise<void> {
    if (goalId !== null && !this.goals.some((g) => g.id === goalId)) return;
    const signalIds = [
      ...new Set(this.items.filter((i) => requested.includes(i.id)).map((i) => i.signalId)),
    ];
    const failures: string[] = [];
    for (const signalId of signalIds) {
      try {
        await apiFetch(`/signals/${encodeURIComponent(signalId)}/thought`, {
          method: goalId === null ? "DELETE" : "PUT",
          ...(goalId === null ? {} : { body: JSON.stringify({ thoughtId: goalId }) }),
        });
      } catch (err) {
        failures.push(String(err));
      }
    }
    if (failures.length > 0) {
      vscode.window.showErrorMessage(
        `mind: could not ${goalId === null ? "unlink" : "link"} ${failures.length} of ${signalIds.length} items. ${failures[0]}`,
      );
    }
    this.load();
  }

  private async newGoal(title: string, parentId: string | null = null): Promise<void> {
    try {
      await apiFetch("/thoughts", {
        method: "POST",
        body: JSON.stringify({ title, body: "", directionId: null, state: "goal", parentId }),
      });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not create the goal. ${String(err)}`);
    }
    this.load();
  }

  private async newSubGoal(parentId: string): Promise<void> {
    const parent = this.goals.find((g) => g.id === parentId);
    if (!parent) return;
    const title = await vscode.window.showInputBox({
      prompt: `New sub-goal under "${parent.title}"`,
      validateInput: (v) => (v.trim() ? undefined : "Enter a title"),
    });
    if (title?.trim()) await this.newGoal(title.trim(), parentId);
  }

  private async renameGoal(goalId: string): Promise<void> {
    const goal = this.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const title = await vscode.window.showInputBox({
      prompt: "Rename goal",
      value: goal.title,
      validateInput: (v) => (v.trim() ? undefined : "Enter a title"),
    });
    if (title === undefined || !title.trim() || title.trim() === goal.title) return;
    await this.patchGoal(goalId, { title: title.trim() }, "rename the goal");
  }

  /** Makes a goal a sub-goal of `parentId`, or top-level when null. */
  private async moveGoal(goalId: string, parentId: string | null): Promise<void> {
    if (!canMoveUnder(this.goals, goalId, parentId)) return;
    await this.patchGoal(goalId, { parentId }, "move the goal");
  }

  private async patchGoal(goalId: string, change: object, what: string): Promise<void> {
    try {
      await apiFetch(`/thoughts/${encodeURIComponent(goalId)}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not ${what}. ${String(err)}`);
    }
    this.load();
  }

  private async setGoalState(goalId: string, state: "closed" | "parked"): Promise<void> {
    if (!this.goals.some((g) => g.id === goalId)) return;
    try {
      await apiFetch(`/thoughts/${encodeURIComponent(goalId)}`, {
        method: "PATCH",
        body: JSON.stringify({ state }),
      });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not update the goal. ${String(err)}`);
    }
    this.load();
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async showTranscript(): Promise<void> {
    try {
      const { text } = await apiFetch<{ text: string }>("/summary");
      this.post({ type: "transcript", text });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not load the summary. ${String(err)}`);
    }
  }

  /** Renders the audio when there is none or it is out of date, then plays it. */
  private async playAudio(): Promise<void> {
    try {
      const meta = await apiFetch<{ audio: { stale: boolean } | null }>("/summary");
      if (!meta.audio || meta.audio.stale) {
        this.post({
          type: "audioStatus",
          text: "Rendering audio (the first run may download the voice)…",
        });
        await apiFetch("/summary/audio", { method: "POST" });
      }
      const wav = await apiFetchBytes("/summary/audio");
      this.post({
        type: "audio",
        src: `data:audio/wav;base64,${wav.toString("base64")}`,
        text: "",
      });
    } catch (err) {
      this.post({ type: "audioStatus", text: readableAudioError(err) });
    }
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Queue",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const now = new Date();
    const today = localDate(now);
    const view = QueuePanel.view;
    const unlinked = unlinkedItems(this.items);
    const counts = viewCounts(unlinked, today);
    const shown = unlinked.filter((i) => inView(i, view, today));
    const goals = sortGoals(this.goals, now);

    const tabs = VIEWS.map(
      (v) =>
        `<button class="tab ${v.id === view ? "active" : ""}" data-action="view" data-view="${v.id}"${
          v.id === "today" ? ' data-drop="today"' : v.id === "backlog" ? ' data-drop="backlog"' : ""
        }>${esc(v.label)}<span class="count">${counts[v.id]}</span></button>`,
    ).join("");

    let content: string;
    if (view === "upcoming") {
      // Grouped by day; ordering within a day is by the saved order, but
      // cross-day dragging is not offered, so cards are not draggable here.
      content = groupByDate(shown)
        .map(
          (
            g,
          ) => `<div class="group-title">${esc(planLabel(g.date, today))} <span class="meta">${g.items.length}</span></div>
            ${g.items.map((i) => this.renderItem(i, today, false)).join("")}`,
        )
        .join("");
    } else {
      content = shown
        .map((i, n) => this.renderItem(i, today, true, view === "today" && n === 0))
        .join("");
    }

    const due = view === "today" ? dueUnplanned(unlinked, today) : [];
    const dueBanner =
      due.length > 0
        ? `<div class="card" style="border-left: 3px solid var(--mind-red);">
             <strong>${due.length} unplanned item${due.length === 1 ? " is" : "s are"} due today or already overdue.</strong>
             <div class="toolbar" style="margin: 6px 0 0;"><button data-action="planDue">Add ${due.length === 1 ? "it" : "them"} to today</button></div>
           </div>`
        : "";

    const empty: Record<QueueView, string> = {
      today: `Nothing is planned for today.${
        counts.backlog > 0
          ? ` <button data-action="view" data-view="backlog">Plan from the backlog (${counts.backlog})</button>`
          : ""
      }`,
      upcoming: "Nothing is planned for a later day.",
      backlog: "The backlog is empty. Everything awaiting action has a plan.",
      all: "Nothing unlinked is awaiting action.",
    };

    const tree = goalTree(this.goals, now);
    const goalCards = tree.map((n) => this.renderGoal(n.goal, n.depth, today, now)).join("");
    const overdueGoals = goals.filter((g) => goalFlags(g, now).includes("overdue")).length;
    const reviewGoals = goals.filter((g) => goalFlags(g, now).includes("review")).length;

    const body = `
      <div class="strip">
        <span class="meta">${this.summary.absorbedToday} handled without reaching you today</span>
        ${overdueGoals > 0 ? `<span class="flag overdue">${overdueGoals} goal${overdueGoals === 1 ? "" : "s"} overdue</span>` : ""}
        ${reviewGoals > 0 ? `<span class="flag review">${reviewGoals} due for review</span>` : ""}
        <button data-action="transcript">Transcript</button>
        <button data-action="audio">▶ Audio</button>
        <span id="audio-status" class="meta"></span>
      </div>
      <div id="transcript-box" hidden><pre id="transcript"></pre></div>
      <div id="audio-box"></div>
      <div class="queue-cols">
        <section>
          <h3 class="col-title" data-goal-root title="Drop a goal here to make it top-level">Goals</h3>
          <div class="new-goal">
            <input id="new-goal" type="text" placeholder="New goal" aria-label="New goal" />
            <button data-action="newGoal" data-value-from="#new-goal">Add</button>
          </div>
          ${goalCards || '<p class="empty">No goals yet.</p>'}
        </section>
        <section>
          <h3 class="col-title">Not linked to a goal</h3>
          <div class="tabs">${tabs}</div>
          <div class="search">
            <input id="signal-search" type="search" value="${esc(QueuePanel.search)}" placeholder="Filter signals" aria-label="Filter signals by any visible text" />
          </div>
          <div class="toolbar">
            <button data-action="refresh">↺ Refresh</button>
            <span id="shown-count" class="meta">${shown.length} awaiting action</span>
          </div>
          <div id="selbar" class="toolbar" hidden>
            <span id="selcount" class="meta"></span>
            <button id="sel-today">Today</button>
            <button id="sel-tomorrow">Tomorrow</button>
            <button id="sel-backlog">Backlog</button>
            <select id="sel-goal" aria-label="Link selected to a goal">
              <option value="">Link to goal…</option>
              ${tree.map((n) => `<option value="${esc(n.goal.id)}">${"\u00a0\u00a0".repeat(n.depth)}${esc(n.goal.title)}</option>`).join("")}
            </select>
            <button id="sel-clear">Clear</button>
          </div>
          ${dueBanner}
          <div id="queue-list">${content}</div>
          ${shown.length === 0 ? `<p class="empty">${empty[view]}</p>` : ""}
          <p id="no-match" class="empty" hidden>No signals match this search.</p>
        </section>
      </div>
    `;
    this.panel.webview.html = this.shell("Queue", body, QUEUE_STYLE, QUEUE_SCRIPT);
  }

  private renderGoal(goal: Goal, depth: number, today: string, now: Date): string {
    const linked = itemsForGoal(this.items, goal.id);
    const flags = goalFlags(goal, now)
      .map((f) => `<span class="flag ${f}">${f === "overdue" ? "Overdue" : "Review due"}</span>`)
      .join(" ");
    const open = QueuePanel.openGoals.has(goal.id);
    // Sub-goals are siblings in the DOM (indented), not nested, so a drop on a
    // sub-goal never also fires on its parent.
    return `<div class="card goal-card${depth > 0 ? " sub" : ""}" draggable="true" data-goal="${esc(goal.id)}" style="margin-left: ${depth * 18}px;">
      <div class="toolbar" style="justify-content: space-between; margin-bottom: 2px;">
        <strong>${esc(goal.title)}</strong>
        <span>${flags}</span>
      </div>
      ${goal.nextAction ? `<div class="meta">Next: ${esc(goal.nextAction)}</div>` : ""}
      ${
        linked.length > 0
          ? `<div class="linked-toggle"><button class="linked-btn" data-toggle-linked="${esc(goal.id)}">${open ? "Hide linked" : "Show linked"}</button>
             <div class="linked"${open ? "" : " hidden"}>${linked.map((i) => this.renderItem(i, today, false, false, true)).join("")}</div></div>`
          : ""
      }
      <div class="toolbar" style="margin: 6px 0 0;">
        <button data-action="renameGoal" data-goal="${esc(goal.id)}">Rename</button>
        <button data-action="newSubGoal" data-goal="${esc(goal.id)}">+ Sub-goal</button>
        <button data-action="goalState" data-goal="${esc(goal.id)}" data-state="closed">Done</button>
        <button data-action="goalState" data-goal="${esc(goal.id)}" data-state="parked">Park</button>
      </div>
    </div>`;
  }

  private renderItem(
    item: QueueItem,
    today: string,
    draggable: boolean,
    upNext = false,
    linked = false,
  ): string {
    const buttons = item.actions
      // An open-link button only appears when the message contains that link.
      .filter((a) => a.kind !== "openLink" || a.linkAvailable !== false)
      .map(
        (a) =>
          `<button data-action="itemAction" data-item="${esc(item.id)}" data-act="${esc(a.id)}">${esc(a.label)}</button>`,
      )
      .join("");

    const state = planState(item.plannedFor, today);
    const planButtons = [
      state !== "today" && state !== "overdue" ? "today" : null,
      item.plannedFor !== addDays(today, 1) ? "tomorrow" : null,
    ]
      .filter((w): w is "today" | "tomorrow" => w !== null)
      .map(
        (w) =>
          `<button data-action="plan" data-item="${esc(item.id)}" data-when="${w}">${w === "today" ? "Today" : "Tomorrow"}</button>`,
      )
      .join("");

    // Line 1 is the whole identity of the item (channel, sender, when it needs
    // you); line 2 is its summary. The rest opens on click.
    const timing = timingLabel(item.timing.bucket, item.timing.actBy);
    return `<div class="card queue-item${upNext ? " up-next" : ""}"${draggable ? ' draggable="true"' : ""} tabindex="0" data-item-id="${esc(item.id)}" data-search="${esc(itemSearchText(item, today))}">
      <div class="item-line clickable">
        <span class="who">${draggable ? '<span class="handle" aria-hidden="true">⠿</span>' : ""}${upNext ? '<span class="badge">Up next</span> ' : ""}<span class="badge">${esc(channelLabel(item.adapter, item.account))}</span> ${esc(item.sender)}</span>
        <span class="timing ${esc(item.timing.bucket)}" title="${esc(item.timing.reason)}">${esc(timing)}</span>
      </div>
      <div class="summary-line">${esc(item.summary)}</div>
      <div class="body">
        ${item.draftPreview ? `<div class="draft-preview"><span class="meta">Draft reply:</span> ${esc(item.draftPreview)}</div>` : ""}
        <div class="meta" style="margin-top: 4px;">${esc(item.timing.reason)}</div>
        <div class="meta">${item.direction ? `${esc(item.direction.name)} · ` : ""}received ${esc(ago(item.receivedAt))} · <span class="plan-chip ${state === "overdue" ? "overdue" : ""}">${esc(planLabel(item.plannedFor, today))}</span></div>
        <div class="toolbar" style="margin-top: 8px; margin-bottom: 0;">
          ${buttons}
          ${linked ? `<button data-action="unlink" data-item="${esc(item.id)}">Unlink</button>` : `<span class="meta">Plan:</span>${planButtons}<button data-action="plan" data-item="${esc(item.id)}" data-when="choose">Plan…</button>`}
          <button data-action="details" data-item="${esc(item.id)}">Details</button>
          <button data-action="open" data-id="${esc(item.signalId)}">View signal</button>
        </div>
      </div>
    </div>`;
  }
}

/** The server answers audio failures with {error, code}; show its message, not the raw HTTP text. */
function readableAudioError(err: unknown): string {
  const text = String(err);
  const json = text.slice(text.indexOf("{"));
  try {
    const parsed = JSON.parse(json) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* not JSON: fall through */
  }
  return text.slice(0, 300);
}
