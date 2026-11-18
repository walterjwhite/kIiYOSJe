import { apiFetch } from "./api-client.js";
import { SectionPanel, esc } from "./webview-base.js";

interface Thought {
  id: string;
  title: string;
  body: string;
  state: string;
  directionId: string | null;
  nextAction: string | null;
  reviewAt: string | null;
  escalateBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Action {
  id: string;
  kind: string;
  status: string;
  adapter: string;
  payload: string;
  signalId: string | null;
}

interface BriefPayload {
  date: string;
  thoughts: {
    active: Thought[];
    overdue: Thought[];
    reviewDue: Thought[];
    newToday: Thought[];
  };
  actions: { proposed: Action[] };
  absorb: { today: number };
  directions: { active: { id: string; name: string; posture: string }[] };
}

export class BriefPanel extends SectionPanel {
  private static current: BriefPanel | undefined;
  private loadError: string | undefined;

  static show(): void {
    if (BriefPanel.current) {
      BriefPanel.current.reveal();
      return;
    }
    BriefPanel.current = new BriefPanel();
  }

  private constructor() {
    super("mind.brief", "Today — mind");
    this.load();
  }

  protected onDispose(): void {
    BriefPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string };
    if (m.command === "refresh") this.load();
  }

  private async load(): Promise<void> {
    let brief: BriefPayload;
    try {
      brief = await apiFetch<BriefPayload>("/brief");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
      this.render(undefined);
      return;
    }
    this.render(brief);
  }

  private render(brief: BriefPayload | undefined): void {
    if (this.loadError || !brief) {
      this.panel.webview.html = this.shell(
        "Today",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError ?? "")}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const sections: string[] = [];

    sections.push(`<div class="toolbar"><button data-action="refresh">↺ Refresh</button></div>`);

    sections.push(
      `<h2>Directions in effect (${brief.directions.active.length})</h2>
       <ul>${brief.directions.active
         .map((d) => `<li>${esc(d.name)} <span class="badge">${esc(d.posture)}</span></li>`)
         .join("")}</ul>`,
    );

    if (brief.thoughts.overdue.length > 0) {
      sections.push(
        `<h2 class="danger">Overdue — response expected (${brief.thoughts.overdue.length})</h2>
         <ul>${brief.thoughts.overdue
           .map(
             (t) =>
               `<li><strong>${esc(t.title)}</strong>${t.escalateBy ? ` <span class="meta">escalate by ${esc(t.escalateBy)}</span>` : ""}</li>`,
           )
           .join("")}</ul>`,
      );
    }

    sections.push(
      `<h2>Active thoughts (${brief.thoughts.active.length})</h2>
       <ul>${brief.thoughts.active.map((t) => `<li>${esc(t.title)}</li>`).join("") || '<li class="empty">Nothing active.</li>'}</ul>`,
    );

    if (brief.thoughts.newToday.length > 0) {
      sections.push(
        `<h2>New today (${brief.thoughts.newToday.length})</h2>
         <ul>${brief.thoughts.newToday.map((t) => `<li>${esc(t.title)}</li>`).join("")}</ul>`,
      );
    }

    if (brief.thoughts.reviewDue.length > 0) {
      sections.push(
        `<h2>Review due (${brief.thoughts.reviewDue.length})</h2>
         <ul>${brief.thoughts.reviewDue
           .map(
             (t) =>
               `<li>${esc(t.title)}${t.reviewAt ? ` <span class="meta">review by ${esc(t.reviewAt)}</span>` : ""}</li>`,
           )
           .join("")}</ul>`,
      );
    }

    sections.push(
      `<h2>Awaiting your approval (${brief.actions.proposed.length})</h2>
       ${
         brief.actions.proposed.length > 0
           ? `<p><a href="command:mind.queue">open Queue</a></p>`
           : '<p class="empty">Nothing pending.</p>'
       }`,
    );

    sections.push(
      `<h2>Absorbed today</h2>
       <p>${brief.absorb.today} signal${brief.absorb.today === 1 ? "" : "s"} handled without reaching you.</p>`,
    );

    this.panel.webview.html = this.shell(
      `Today — ${esc(brief.date)}`,
      sections.join("\n"),
    );
  }
}
