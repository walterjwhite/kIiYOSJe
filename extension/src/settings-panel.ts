import { apiFetch } from "./api-client.js";
import { SectionPanel, esc, toggleSwitch } from "./webview-base.js";

interface DisplaySettings {
  showSubject: boolean;
  showCc: boolean;
  showBcc: boolean;
  preferHtmlBody: boolean;
}

/**
 * Settings — which signal fields/attributes the extension shows by
 * default (GET/PUT /admin/display). A signal can carry more than a quick
 * glance shows (subject, Cc, Bcc, an HTML body alongside the plain-text
 * one); this is where that's turned on or off, rather than always showing
 * everything a signal might have.
 */
export class SettingsPanel extends SectionPanel {
  private static current: SettingsPanel | undefined;
  private settings: DisplaySettings | undefined;
  private loadError: string | undefined;

  static show(): void {
    if (SettingsPanel.current) {
      SettingsPanel.current.reveal();
      return;
    }
    SettingsPanel.current = new SettingsPanel();
  }

  private constructor() {
    super("mind.settings", "Settings — mind");
    this.load();
  }

  protected onDispose(): void {
    SettingsPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; field?: string };
    if (m.command === "refresh") this.load();
    else if (m.command === "toggleField" && m.field) this.toggleField(m.field);
  }

  private async load(): Promise<void> {
    try {
      this.settings = await apiFetch<DisplaySettings>("/admin/display");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async toggleField(field: string): Promise<void> {
    if (!this.settings) return;
    const key = field as keyof DisplaySettings;
    const updated: DisplaySettings = { ...this.settings, [key]: !this.settings[key] };
    try {
      await apiFetch("/admin/display", { method: "PUT", body: JSON.stringify(updated) });
    } catch (err) {
      this.loadError = String(err);
      this.render();
      return;
    }
    this.settings = updated;
    this.render();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Settings",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const s = this.settings;
    if (!s) return;

    const row = (field: keyof DisplaySettings, label: string, hint: string) => `
      <tr>
        <td>${toggleSwitch(s[field], "toggleField", { field })}</td>
        <td>${esc(label)}</td>
        <td class="meta">${esc(hint)}</td>
      </tr>
    `;

    const body = `
      <p class="sub">What a Signal Detail screen shows by default. The data is always there; this controls what's rendered without opening it explicitly.</p>
      <table>
        <thead><tr><th></th><th>Field</th><th></th></tr></thead>
        <tbody>
          ${row("showSubject", "Subject", "Mail signals' original subject line")}
          ${row("showCc", "Cc", "Addresses copied on a mail signal")}
          ${row("showBcc", "Bcc", "Addresses blind-copied, when visible to the account")}
          ${row("preferHtmlBody", "Prefer HTML body", "Render the original HTML natively when the source provides one, instead of only the plain-text extract")}
        </tbody>
      </table>
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
      </div>
    `;

    this.panel.webview.html = this.shell("Settings", body);
  }
}
