import { apiFetch } from "./api-client.js";
import { esc, SectionPanel, toggleSwitch } from "./webview-base.js";

interface AudioSettings {
  voice: string;
  speaker: number | null;
  speed: number;
  tone: "calm" | "neutral" | "upbeat";
  piperCommand: string;
  autoDownload: boolean;
}

interface AutolinkSettings {
  enabled: boolean;
  threshold: number;
}

interface LearningSettings {
  windowStart: string;
  windowEnd: string;
}

const SETTINGS_STYLE = `
  .form { display: grid; grid-template-columns: 160px minmax(0, 420px); gap: 8px 12px; align-items: center; margin: 8px 0 12px; }
  .form .hint { grid-column: 2; margin-top: -4px; }
`;

const SETTINGS_SCRIPT = `
(function () {
  function val(id) { return document.getElementById(id).value; }
  var audio = document.getElementById('save-audio');
  if (audio) audio.addEventListener('click', function () {
    post({
      command: 'saveAudio',
      voice: val('a-voice').trim(),
      speed: Number(val('a-speed')),
      tone: val('a-tone'),
      speaker: val('a-speaker').trim() === '' ? null : Number(val('a-speaker')),
      piperCommand: val('a-command').trim()
    });
  });
  var learning = document.getElementById('save-learning');
  if (learning) learning.addEventListener('click', function () {
    post({ command: 'saveLearning', windowStart: val('lw-start'), windowEnd: val('lw-end') });
  });
  var link = document.getElementById('save-threshold');
  if (link) link.addEventListener('click', function () {
    post({ command: 'saveThreshold', threshold: Number(val('l-threshold')) });
  });
})();
`;

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
  private audio: AudioSettings | undefined;
  private autolink: AutolinkSettings | undefined;
  private learning: LearningSettings | undefined;
  private notice: string | undefined;
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
    const m = msg as {
      command?: string;
      field?: string;
      voice?: string;
      speed?: number;
      tone?: AudioSettings["tone"];
      speaker?: number | null;
      piperCommand?: string;
      threshold?: number;
      windowStart?: string;
      windowEnd?: string;
    };
    if (m.command === "refresh") this.load();
    else if (m.command === "toggleField" && m.field) this.toggleField(m.field);
    else if (m.command === "toggleAutoDownload" && this.audio) {
      void this.saveAudio({ ...this.audio, autoDownload: !this.audio.autoDownload });
    } else if (m.command === "saveAudio" && this.audio) {
      void this.saveAudio({
        ...this.audio,
        voice: String(m.voice ?? ""),
        speed: Number(m.speed),
        tone: m.tone ?? this.audio.tone,
        speaker: m.speaker ?? null,
        piperCommand: String(m.piperCommand ?? ""),
      });
    } else if (m.command === "toggleAutolink" && this.autolink) {
      void this.saveAutolink({ ...this.autolink, enabled: !this.autolink.enabled });
    } else if (m.command === "saveLearning" && this.learning) {
      void this.save(
        "/admin/learning",
        { windowStart: String(m.windowStart ?? ""), windowEnd: String(m.windowEnd ?? "") },
        "Learning window saved.",
        (v) => (this.learning = v),
      );
    } else if (m.command === "saveThreshold" && this.autolink) {
      void this.saveAutolink({ ...this.autolink, threshold: Number(m.threshold) });
    }
  }

  private async load(): Promise<void> {
    try {
      [this.settings, this.audio, this.autolink, this.learning] = await Promise.all([
        apiFetch<DisplaySettings>("/admin/display"),
        apiFetch<AudioSettings>("/admin/audio"),
        apiFetch<AutolinkSettings>("/admin/autolink"),
        apiFetch<LearningSettings>("/admin/learning"),
      ]);
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

  /** The server validates; a rejection is shown here instead of being swallowed. */
  private async saveAudio(next: AudioSettings): Promise<void> {
    await this.save("/admin/audio", next, "Audio settings saved.", (v) => (this.audio = v));
  }

  private async saveAutolink(next: AutolinkSettings): Promise<void> {
    await this.save(
      "/admin/autolink",
      next,
      "Auto-link settings saved.",
      (v) => (this.autolink = v),
    );
  }

  private async save<T>(path: string, next: T, ok: string, apply: (v: T) => void): Promise<void> {
    try {
      await apiFetch(path, { method: "PUT", body: JSON.stringify(next) });
      apply(next);
      this.notice = ok;
    } catch (err) {
      this.notice = `Not saved: ${String(err).slice(0, 300)}`;
    }
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
    const a = this.audio;
    const l = this.autolink;
    const w = this.learning;
    if (!s || !a || !l || !w) return;

    const row = (field: keyof DisplaySettings, label: string) => `
      <tr>
        <td>${toggleSwitch(s[field], "toggleField", { field })}</td>
        <td>${esc(label)}</td>
              </tr>
    `;

    const body = `
      <table>
        <thead><tr><th></th><th>Field</th></tr></thead>
        <tbody>
          ${row("showSubject", "Subject")}
          ${row("showCc", "Cc")}
          ${row("showBcc", "Bcc")}
          ${row("preferHtmlBody", "Prefer HTML body")}
        </tbody>
      </table>
      <h2>Auto-link to goals</h2>
      <div class="form">
        <label>Automatic linking</label>
        <div>${toggleSwitch(l.enabled, "toggleAutolink", {})}</div>
        <label for="l-threshold">Minimum confidence</label>
        <div><input id="l-threshold" type="number" min="0.5" max="1" step="0.05" value="${l.threshold}" /> <button id="save-threshold">Save</button></div>
      </div>

      <h2>Learning loop</h2>
      <p class="sub">Once a night the learning loop reads the last 7 days of your decisions and suggests changes to Directions. It may also ask the AI model for an explanation, so it runs while you are likely away. Times are 24-hour, in this computer's time zone. If the end is earlier than the start, the window crosses midnight.</p>
      <div class="form">
        <label for="lw-start">Window starts</label>
        <input id="lw-start" type="time" value="${esc(w.windowStart)}" />
        <label for="lw-end">Window ends</label>
        <input id="lw-end" type="time" value="${esc(w.windowEnd)}" />
        <span></span>
        <div><button id="save-learning">Save learning window</button></div>
      </div>

      <h2>Audio summary</h2>
      <div class="form">
        <label for="a-voice">Voice</label>
        <input id="a-voice" type="text" value="${esc(a.voice)}" placeholder="en_US-lessac-medium" spellcheck="false" />
        <label for="a-speed">Speed</label>
        <input id="a-speed" type="number" min="0.5" max="2" step="0.05" value="${a.speed}" />
        <label for="a-tone">Tone</label>
        <select id="a-tone">${(["calm", "neutral", "upbeat"] as const)
          .map((t) => `<option value="${t}"${t === a.tone ? " selected" : ""}>${t}</option>`)
          .join("")}</select>
        <label for="a-speaker">Speaker number</label>
        <input id="a-speaker" type="number" min="0" step="1" value="${a.speaker ?? ""}"  />
        <label for="a-command">Piper command</label>
        <input id="a-command" type="text" value="${esc(a.piperCommand)}" spellcheck="false" />
        <label>Download voices (huggingface.co)</label>
        <div>${toggleSwitch(a.autoDownload, "toggleAutoDownload", {})}</div>
        <span></span>
        <div><button id="save-audio">Save audio settings</button></div>
      </div>
      ${this.notice ? `<p class="${this.notice.startsWith("Not saved") ? "danger" : "meta"}">${esc(this.notice)}</p>` : ""}
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
      </div>
    `;

    this.panel.webview.html = this.shell("Settings", body, SETTINGS_STYLE, SETTINGS_SCRIPT);
  }
}
