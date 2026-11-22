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

interface ResilienceSettings {
  timeoutSeconds: number;
  retries: number;
  retryDelayMs: number;
  breakerFailures: number;
  breakerResetSeconds: number;
  maxConcurrent: number;
}

interface SensitiveTopic {
  name: string;
  keywords: string[];
  enabled: boolean;
}

interface SensitiveSettings {
  topics: SensitiveTopic[];
}

interface LearningSettings {
  windowStart: string;
  windowEnd: string;
  idleEnabled: boolean;
  idleMinutes: number;
  minNewDecisions: number;
  minGapMinutes: number;
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
    post({
      command: 'saveLearning',
      windowStart: val('lw-start'),
      windowEnd: val('lw-end'),
      idleEnabled: document.getElementById('li-enabled').checked,
      idleMinutes: Number(val('li-idle')),
      minNewDecisions: Number(val('li-decisions')),
      minGapMinutes: Number(val('li-gap'))
    });
  });
  var resilience = document.getElementById('save-resilience');
  if (resilience) resilience.addEventListener('click', function () {
    post({
      command: 'saveResilience',
      timeoutSeconds: Number(val('rs-timeout')),
      retries: Number(val('rs-retries')),
      retryDelayMs: Number(val('rs-delay')),
      breakerFailures: Number(val('rs-failures')),
      breakerResetSeconds: Number(val('rs-reset')),
      maxConcurrent: Number(val('rs-concurrent'))
    });
  });
  var sensitive = document.getElementById('save-sensitive');
  if (sensitive) sensitive.addEventListener('click', function () {
    var topics = [];
    document.querySelectorAll('.st-row').forEach(function (row) {
      topics.push({
        name: row.querySelector('.st-name').value,
        keywords: row.querySelector('.st-kw').value,
        enabled: row.querySelector('.st-on').checked
      });
    });
    post({ command: 'saveSensitive', topics: topics });
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
  private sensitive: SensitiveSettings | undefined;
  private resilience: ResilienceSettings | undefined;
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
      idleEnabled?: boolean;
      idleMinutes?: number;
      minNewDecisions?: number;
      minGapMinutes?: number;
      topics?: { name?: string; keywords?: string; enabled?: boolean }[];
      timeoutSeconds?: number;
      retries?: number;
      retryDelayMs?: number;
      breakerFailures?: number;
      breakerResetSeconds?: number;
      maxConcurrent?: number;
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
        {
          windowStart: String(m.windowStart ?? ""),
          windowEnd: String(m.windowEnd ?? ""),
          idleEnabled: m.idleEnabled === true,
          idleMinutes: Number(m.idleMinutes),
          minNewDecisions: Number(m.minNewDecisions),
          minGapMinutes: Number(m.minGapMinutes),
        },
        "Learning settings saved.",
        (v) => (this.learning = v),
      );
    } else if (m.command === "saveResilience" && this.resilience) {
      void this.save(
        "/admin/resilience",
        {
          timeoutSeconds: Number(m.timeoutSeconds),
          retries: Number(m.retries),
          retryDelayMs: Number(m.retryDelayMs),
          breakerFailures: Number(m.breakerFailures),
          breakerResetSeconds: Number(m.breakerResetSeconds),
          maxConcurrent: Number(m.maxConcurrent),
        },
        "Model call settings saved.",
        (v) => (this.resilience = v),
      );
    } else if (m.command === "saveSensitive" && this.sensitive) {
      const rows = Array.isArray(m.topics) ? m.topics : [];
      // A row with no name is dropped, which is how a topic is removed.
      const topics = rows
        .filter((r) => typeof r.name === "string" && r.name.trim() !== "")
        .map((r) => ({
          name: String(r.name).trim(),
          keywords: String(r.keywords ?? "")
            .split("\n")
            .map((k) => k.trim())
            .filter((k) => k !== ""),
          enabled: r.enabled === true,
        }));
      void this.save(
        "/admin/sensitive",
        { topics },
        "Sensitive topics saved.",
        (v) => (this.sensitive = v),
      );
    } else if (m.command === "saveThreshold" && this.autolink) {
      void this.saveAutolink({ ...this.autolink, threshold: Number(m.threshold) });
    }
  }

  private async load(): Promise<void> {
    try {
      [this.settings, this.audio, this.autolink, this.learning, this.sensitive] = await Promise.all(
        [
          apiFetch<DisplaySettings>("/admin/display"),
          apiFetch<AudioSettings>("/admin/audio"),
          apiFetch<AutolinkSettings>("/admin/autolink"),
          apiFetch<LearningSettings>("/admin/learning"),
          apiFetch<SensitiveSettings>("/admin/sensitive"),
          apiFetch<ResilienceSettings>("/admin/resilience"),
        ],
      );
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
    const sens = this.sensitive;
    const r = this.resilience;
    if (!s || !a || !l || !w || !sens || !r) return;

    const topicRow = (t: SensitiveTopic | undefined, i: number) => `
        <tr class="st-row">
          <td><input type="checkbox" class="st-on"${t?.enabled === false ? "" : " checked"} aria-label="Topic on" /></td>
          <td><input type="text" class="st-name" value="${esc(t?.name ?? "")}" placeholder="new topic" maxlength="40" aria-label="Topic name ${i + 1}" /></td>
          <td><textarea class="st-kw" rows="3" spellcheck="false" aria-label="Keywords for topic ${i + 1}">${esc((t?.keywords ?? []).join("\n"))}</textarea></td>
        </tr>`;
    const topicRows = [
      ...sens.topics.map((t, i) => topicRow(t, i)),
      topicRow(undefined, sens.topics.length),
    ].join("");

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
      <p class="sub">The learning loop reads the last 7 days of your decisions and suggests changes to Directions. It may also ask the AI model for an explanation. It runs once a night inside the window below, and also when you have been idle and enough new decisions have come in. Times are 24-hour, in this computer's time zone. If the end is earlier than the start, the window crosses midnight.</p>
      <div class="form">
        <label for="lw-start">Window starts</label>
        <input id="lw-start" type="time" value="${esc(w.windowStart)}" />
        <label for="lw-end">Window ends</label>
        <input id="lw-end" type="time" value="${esc(w.windowEnd)}" />
        <label for="li-enabled">Run when idle</label>
        <div><input id="li-enabled" type="checkbox"${w.idleEnabled ? " checked" : ""} /></div>
        <label for="li-idle">Idle after (minutes)</label>
        <input id="li-idle" type="number" min="1" max="240" step="1" value="${w.idleMinutes}" />
        <label for="li-decisions">New decisions needed</label>
        <input id="li-decisions" type="number" min="1" max="1000" step="1" value="${w.minNewDecisions}" />
        <label for="li-gap">At least this many minutes apart</label>
        <input id="li-gap" type="number" min="5" max="1440" step="1" value="${w.minGapMinutes}" />
        <span></span>
        <div class="sub">A decision is a reply you approve, a draft you discard, or a signal you move to another Direction. Idle means no signal was processed and nothing was decided for the idle time.</div>
        <span></span>
        <div><button id="save-learning">Save learning settings</button></div>
      </div>

      <h2>Model calls</h2>
      <p class="sub">How mind protects itself from a slow or failing model. Each call has a time limit and retries a temporary failure (timeout, rate limit, server error) with a growing wait. After several failures in a row it stops calling the model for a while, and messages wait for you instead of being answered. At most this many calls run at once. Changes apply to the next call.</p>
      <div class="form">
        <label for="rs-timeout">Time limit (seconds)</label>
        <input id="rs-timeout" type="number" min="5" max="900" step="1" value="${r.timeoutSeconds}" />
        <label for="rs-retries">Retries</label>
        <input id="rs-retries" type="number" min="0" max="5" step="1" value="${r.retries}" />
        <label for="rs-delay">First wait before a retry (ms)</label>
        <input id="rs-delay" type="number" min="100" max="30000" step="100" value="${r.retryDelayMs}" />
        <label for="rs-failures">Failures in a row that pause calls</label>
        <input id="rs-failures" type="number" min="1" max="50" step="1" value="${r.breakerFailures}" />
        <label for="rs-reset">Pause length (seconds)</label>
        <input id="rs-reset" type="number" min="5" max="3600" step="1" value="${r.breakerResetSeconds}" />
        <label for="rs-concurrent">Calls at once</label>
        <input id="rs-concurrent" type="number" min="1" max="8" step="1" value="${r.maxConcurrent}" />
        <span></span>
        <div><button id="save-resilience">Save model call settings</button></div>
      </div>

      <h2>Sensitive topics</h2>
      <p class="sub">A message that mentions one of these is never absorbed, drafted, or sent. It becomes a Thought for you. Put one word or phrase per line. Matching is on whole words, and different forms of a word match ("surgeries" matches "surgery"), but "taxi" does not match "tax". The model can also flag a topic by name. Every hold is one more Thought, so keep the lists short. To remove a topic, clear its name and save. The defaults are English and a starting point.</p>
      <table>
        <thead><tr><th>On</th><th>Topic</th><th>Keywords, one per line</th></tr></thead>
        <tbody>${topicRows}</tbody>
      </table>
      <div><button id="save-sensitive">Save sensitive topics</button></div>

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
