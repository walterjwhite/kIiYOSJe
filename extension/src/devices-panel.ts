import { apiFetch, pairingServerUrl } from "./api-client.js";
import { ago } from "./format.js";
import { qrSvg } from "./qr.js";
import { esc, SectionPanel } from "./webview-base.js";

/**
 * Devices — the clients paired to this server, and pairing a new one.
 *
 * This is the real device registry now, not the earlier preview. **+ Add new
 * Device** opens a form with a name and permissions and shows a six-digit code
 * at once; the phone enters it and receives its own token. The code expires, so
 * the form counts it down and fetches a fresh one when it runs out, and it
 * fetches one again when the name or permissions change, because the code is
 * issued for exactly those. Only this editor's master token can list, pair,
 * change or revoke (the server refuses device tokens on /devices*), so a lost
 * phone cannot revoke the others. Revoking or changing permissions takes effect
 * on that device's next request because auth looks the token up every time.
 */

interface DeviceRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly scopes: readonly string[];
  readonly pairedAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

interface PairingStart {
  readonly pairingId: string;
  readonly code: string;
  readonly expiresAt: string;
  readonly name: string;
  readonly scopes: readonly string[];
}

const SCOPES = ["read", "capture", "send", "render", "settings"] as const;
const DEFAULT_NAME = "My Android phone";
/** The least a new phone needs to show the Queue and add a thought. */
const DEFAULT_SCOPES: readonly string[] = ["read", "capture"];
const POLL_MS = 3000;

const DEVICES_STYLE = `
  .pair-form { border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 14px 16px; margin-top: 12px; }
  .pair-form label.field { display: block; margin: 10px 0 4px; font-size: 0.85em; opacity: 0.8; }
  .pair-form input[type="text"] { width: 100%; max-width: 360px; }
  .scope-options { display: flex; gap: 8px 22px; flex-wrap: wrap; margin: 6px 0 0; }
  .scope-options .scope, .scope-editor .scope { display: flex; gap: 8px; align-items: center; font-size: 0.9em; }
  .scope-editor { display: flex; flex-direction: column; gap: 6px; padding: 4px 0; }
  .scope-editor .actions { display: flex; gap: 6px; margin-top: 4px; }
  .pair-actions { display: flex; gap: 8px; margin-top: 14px; }
  .device-name, .device-scopes { cursor: text; }
  .code-note { text-align: center; margin-top: 6px; }
  .pairing-qr { display: flex; justify-content: center; margin: 2px 0 12px; }
  .pairing-qr svg { max-width: 100%; height: auto; border-radius: 6px; }
  .pair-form .pairing-panel { margin-top: 14px; opacity: 1; }
  .pair-timer { max-width: 280px; margin: 0 auto 6px; text-align: center; }
  .pair-timer-track { height: 6px; border-radius: 3px; background: var(--vscode-widget-border); overflow: hidden; }
  .pair-timer-bar { height: 100%; width: 100%; background: var(--mind-accent); transition: width 250ms linear, background-color 250ms; }
  .pair-timer.low .pair-timer-bar { background: var(--mind-yellow); }
  .pair-timer.critical .pair-timer-bar { background: var(--mind-red); }
`;

/** Runs in the webview. ALL_SCOPES is defined ahead of it by the host. */
const DEVICES_SCRIPT = `
  function switchHtml(scope, on) {
    var sw = document.createElement('span');
    sw.className = 'switch' + (on ? ' on' : '');
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(on));
    sw.setAttribute('aria-label', scope);
    sw.setAttribute('data-scope', scope);
    sw.tabIndex = 0;
    var track = document.createElement('span'); track.className = 'switch-track';
    var thumb = document.createElement('span'); thumb.className = 'switch-thumb';
    sw.appendChild(track); sw.appendChild(thumb);
    sw.addEventListener('click', function () {
      var now = sw.classList.toggle('on');
      sw.setAttribute('aria-checked', String(now));
    });
    return sw;
  }
  function onScopes(root) {
    return Array.prototype.map.call(root.querySelectorAll('.switch.on'), function (el) { return el.getAttribute('data-scope'); });
  }

  var add = document.getElementById('devices-add');
  if (add) add.addEventListener('click', function () { post({ command: 'add-device' }); });
  var cancel = document.getElementById('devices-pair-cancel');
  if (cancel) cancel.addEventListener('click', function () { post({ command: 'cancel-pairing' }); });

  // Pairing form: the code is issued for this name and these permissions, so any
  // change asks for a new code (after a short pause, so typing is not one request
  // per key), and so does the countdown reaching zero.
  var nameInput = document.getElementById('devices-pair-name');
  var scopeBox = document.getElementById('devices-pair-scopes');
  var timer = document.getElementById('pair-timer');
  var codeEl = document.getElementById('pair-code');
  var qrEl = document.getElementById('pair-qr');
  var errEl = document.getElementById('pair-error');
  var barEl = document.getElementById('pair-timer-bar');
  var textEl = document.getElementById('pair-timer-text');
  var end = 0, total = 1, requested = false, pause = null;

  function requestCode() {
    clearTimeout(pause);
    requested = true;
    post({ command: 'update-pairing', name: nameInput.value, scopes: onScopes(scopeBox) });
  }
  function later(ms) { clearTimeout(pause); pause = setTimeout(requestCode, ms); }
  function tick() {
    if (!timer) return;
    var left = Math.max(0, end - Date.now());
    var seconds = Math.ceil(left / 1000);
    barEl.style.width = (end ? (left / total) * 100 : 0) + '%';
    timer.classList.toggle('low', end > 0 && seconds <= 60);
    timer.classList.toggle('critical', end > 0 && seconds <= 20);
    textEl.textContent = end ? 'New code in ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : '';
    if (end && left === 0 && !requested) requestCode();
  }
  function setQr(svg) {
    qrEl.replaceChildren();
    if (!svg) return;
    var root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (root && root.nodeName === 'svg') qrEl.appendChild(document.importNode(root, true));
  }
  if (timer) {
    end = Date.now() + Number(timer.getAttribute('data-ttl-ms') || 0);
    total = Math.max(Number(timer.getAttribute('data-ttl-ms') || 0), 1);
    requested = end <= Date.now();
    tick();
    setInterval(tick, 250);
    scopeBox.querySelectorAll('.switch').forEach(function (sw) {
      sw.addEventListener('click', function () { later(400); });
    });
    nameInput.addEventListener('input', function () { later(700); });
    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (!m || m.type !== 'pairing') return;
      errEl.textContent = m.error || '';
      errEl.hidden = !m.error;
      if (m.error) {
        codeEl.textContent = '--- ---';
        setQr('');
        end = 0;
      } else {
        codeEl.textContent = m.code.slice(0, 3) + ' ' + m.code.slice(3);
        setQr(m.qr);
        end = Date.now() + m.ttlMs;
        total = Math.max(m.ttlMs, 1);
        requested = false;
      }
      tick();
    });
  }

  // Double-click a device name to rename it in place: Enter or blur saves, Escape cancels.
  document.querySelectorAll('.device-name').forEach(function (name) {
    name.addEventListener('dblclick', function () {
      if (name.querySelector('input')) return;
      var original = name.textContent;
      var input = document.createElement('input');
      input.type = 'text';
      input.value = original;
      input.maxLength = 80;
      input.setAttribute('aria-label', 'Device name');
      var done = false;
      function finish(save) {
        if (done) return;
        done = true;
        var text = input.value.trim();
        name.textContent = save && text ? text : original;
        if (save && text && text !== original) {
          post({ command: 'renameDevice', deviceId: name.getAttribute('data-device-id'), name: text });
        }
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', function () { finish(true); });
      name.textContent = '';
      name.appendChild(input);
      input.focus();
      input.select();
    });
  });

  // Double-click a device's permissions to show a toggle for each; Save applies
  // them on the device's next request, Escape or Cancel leaves them as they were.
  document.querySelectorAll('.device-scopes').forEach(function (cell) {
    cell.addEventListener('dblclick', function () {
      if (cell.querySelector('.scope-editor')) return;
      var original = cell.textContent;
      var have = (cell.getAttribute('data-scopes') || '').split(',');
      var editor = document.createElement('div');
      editor.className = 'scope-editor';
      ALL_SCOPES.forEach(function (scope) {
        var row = document.createElement('div');
        row.className = 'scope';
        var sw = switchHtml(scope, have.indexOf(scope) >= 0);
        sw.addEventListener('click', function () { save.disabled = onScopes(editor).length === 0; });
        var label = document.createElement('span');
        label.textContent = scope;
        row.appendChild(sw);
        row.appendChild(label);
        editor.appendChild(row);
      });
      var actions = document.createElement('div');
      actions.className = 'actions';
      var save = document.createElement('button');
      save.textContent = 'Save';
      var back = document.createElement('button');
      back.textContent = 'Cancel';
      actions.appendChild(save);
      actions.appendChild(back);
      editor.appendChild(actions);
      function close() { cell.textContent = original; }
      save.addEventListener('click', function () {
        var scopes = onScopes(editor);
        if (scopes.length === 0) return;
        cell.textContent = 'Saving…';
        post({ command: 'setScopes', deviceId: cell.getAttribute('data-device-id'), scopes: scopes });
      });
      back.addEventListener('click', close);
      editor.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
      cell.textContent = '';
      cell.appendChild(editor);
      var first = editor.querySelector('.switch');
      if (first) first.focus();
    });
  });
`;

export class DevicesPanel extends SectionPanel {
  private static current: DevicesPanel | undefined;

  private devices: readonly DeviceRow[] = [];
  private error: string | null = null;

  /** The pairing form is open. */
  private adding = false;
  private pairing: PairingStart | null = null;
  private pairingError: string | null = null;
  private formName = DEFAULT_NAME;
  private formScopes: readonly string[] = DEFAULT_SCOPES;
  /** Bumped on every code request, so a slow answer to an older request is discarded. */
  private pairingRequest = 0;
  private poll: ReturnType<typeof setInterval> | undefined;

  static show(): void {
    if (DevicesPanel.current) {
      DevicesPanel.current.reveal();
      return;
    }
    DevicesPanel.current = new DevicesPanel();
  }

  private constructor() {
    super("mind.devices", "Devices — mind");
    void this.refresh();
  }

  protected onDispose(): void {
    DevicesPanel.current = undefined;
    this.closeForm();
  }

  protected onMessage(msg: unknown): void {
    void this.handle(msg);
  }

  private async handle(msg: unknown): Promise<void> {
    if (typeof msg !== "object" || msg === null) return;
    const data = msg as Record<string, unknown>;
    const command = data["command"];

    if (command === "add-device") {
      this.adding = true;
      this.formName = DEFAULT_NAME;
      this.formScopes = DEFAULT_SCOPES;
      await this.issuePairing();
      this.startPolling();
      this.render();
      return;
    }

    if (command === "update-pairing") {
      this.formName = cleanName(data["name"]) || DEFAULT_NAME;
      this.formScopes = cleanScopes(data["scopes"]);
      if (!this.adding) return;
      // A newer request supersedes this one; only the latest answer is shown.
      if (await this.issuePairing()) this.postPairing();
      return;
    }

    if (command === "cancel-pairing") {
      this.closeForm();
      this.render();
      return;
    }

    if (command === "refresh") {
      await this.refresh();
      return;
    }

    if (command === "renameDevice") {
      const name = cleanName(data["name"]);
      const current = this.devices.find((d) => d.id === data["deviceId"]);
      if (!current || !name || name === current.name) {
        this.render();
        return;
      }
      await this.patchDevice(current.id, { name });
      return;
    }

    if (command === "setScopes") {
      const scopes = cleanScopes(data["scopes"]);
      const current = this.devices.find((d) => d.id === data["deviceId"]);
      if (!current || scopes.length === 0) {
        this.render();
        return;
      }
      await this.patchDevice(current.id, { scopes });
      return;
    }

    if (command === "revoke") {
      const deviceId = data["deviceId"];
      if (typeof deviceId !== "string") return;
      try {
        await apiFetch(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
        this.error = null;
        await this.refresh(false);
      } catch (err) {
        this.error = String(err);
      }
      this.render();
    }
  }

  private async patchDevice(deviceId: string, change: object): Promise<void> {
    try {
      await apiFetch(`/devices/${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
      this.error = null;
      await this.refresh();
    } catch (err) {
      this.error = String(err);
      this.render();
    }
  }

  private async refresh(render = true): Promise<void> {
    try {
      this.devices = await apiFetch<DeviceRow[]>("/devices");
      this.error = null;
    } catch (err) {
      this.error = String(err);
    }
    if (render) this.render();
  }

  /**
   * Asks the server for a code for the form's current name and permissions and
   * withdraws the previous one, so a code issued with wider permissions than
   * the operator then chose cannot be used before it expires.
   */
  private async issuePairing(): Promise<boolean> {
    const request = ++this.pairingRequest;
    const previous = this.pairing;
    this.pairing = null;
    this.pairingError = null;
    if (previous) void this.withdraw(previous.pairingId);
    if (this.formScopes.length === 0) {
      this.pairingError = "Pick at least one permission for the device.";
      return true;
    }
    try {
      const issued = await apiFetch<PairingStart>("/devices/pairing", {
        method: "POST",
        body: JSON.stringify({ name: this.formName, kind: "android", scopes: this.formScopes }),
      });
      if (request !== this.pairingRequest || !this.adding) {
        void this.withdraw(issued.pairingId);
        return false;
      }
      this.pairing = issued;
    } catch (err) {
      if (request === this.pairingRequest) this.pairingError = String(err);
    }
    return request === this.pairingRequest;
  }

  private async withdraw(pairingId: string): Promise<void> {
    try {
      await apiFetch(`/devices/pairing/${encodeURIComponent(pairingId)}`, { method: "DELETE" });
    } catch {
      // The code expires on its own within minutes; nothing else to do.
    }
  }

  /** Updates the code on screen in place, so the form keeps what is being typed. */
  private postPairing(): void {
    const pairing = this.pairing;
    if (!pairing) {
      void this.panel.webview.postMessage({
        type: "pairing",
        error: this.pairingError ?? "Could not get a pairing code.",
      });
      return;
    }
    void this.panel.webview.postMessage({
      type: "pairing",
      code: pairing.code,
      qr: this.qr(pairing.code),
      ttlMs: Math.max(0, Date.parse(pairing.expiresAt) - Date.now()),
    });
  }

  /** Closes the form and withdraws any unused code. */
  private closeForm(): void {
    this.adding = false;
    this.pairingRequest++;
    this.stopPolling();
    const pairing = this.pairing;
    this.pairing = null;
    this.pairingError = null;
    if (pairing) void this.withdraw(pairing.pairingId);
  }

  /** While the form is open, notice a device arriving so the used code is not left on screen. */
  private startPolling(): void {
    this.stopPolling();
    this.poll = setInterval(() => void this.checkForNewDevice(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
  }

  private async checkForNewDevice(): Promise<void> {
    try {
      const rows = await apiFetch<DeviceRow[]>("/devices");
      const known = new Set(this.devices.map((d) => d.id));
      const arrived = rows.some((r) => !known.has(r.id));
      this.devices = rows;
      if (arrived && this.adding) {
        // The code was used; it no longer needs withdrawing.
        this.adding = false;
        this.pairing = null;
        this.pairingRequest++;
        this.stopPolling();
        this.render();
      }
    } catch {
      // The Refresh button reports connection problems.
    }
  }

  private qr(code: string): string {
    // One image carries the address and the code, so pairing is a scan rather
    // than typing a URL on a phone keyboard.
    try {
      return qrSvg(`mind://pair?server=${encodeURIComponent(pairingServerUrl())}&code=${code}`, {
        scale: 6,
      });
    } catch {
      // An address too long for the encoder still pairs by hand; keep the digits.
      return "";
    }
  }

  private pairForm(): string {
    const options = SCOPES.map((scope) => {
      const on = this.formScopes.includes(scope);
      return `
        <div class="scope">
          <span class="switch${on ? " on" : ""}" data-scope="${esc(scope)}" role="switch" aria-checked="${on}" aria-label="${esc(scope)}" tabindex="0">
            <span class="switch-track"></span><span class="switch-thumb"></span>
          </span>
          <span>${esc(scope)}</span>
        </div>`;
    }).join("");

    const pairing = this.pairing;
    const code = pairing?.code ?? "";
    const shown = code ? `${esc(code.slice(0, 3))} ${esc(code.slice(3))}` : "--- ---";
    const ttl = pairing ? Math.max(0, Date.parse(pairing.expiresAt) - Date.now()) : 0;
    const qr = code ? this.qr(code) : "";

    return `
      <div class="pair-form">
        <label class="field" for="devices-pair-name">Device name</label>
        <input type="text" id="devices-pair-name" value="${esc(this.formName)}" maxlength="80">
        <label class="field">Permissions for this device</label>
        <div class="scope-options" id="devices-pair-scopes">${options}</div>
        <div class="pairing-panel">
          <div class="pairing-qr" id="pair-qr">${qr}</div>
          <div class="pairing-code" id="pair-code" aria-live="polite">${shown}</div>
          <div class="pair-timer" id="pair-timer" data-ttl-ms="${ttl}" role="timer">
            <div class="pair-timer-track"><div class="pair-timer-bar" id="pair-timer-bar"></div></div>
            <span class="meta" id="pair-timer-text"></span>
          </div>
          <p class="danger code-note" id="pair-error" role="alert"${this.pairingError ? "" : " hidden"}>${esc(this.pairingError ?? "")}</p>
          <p class="sub code-note">
            Scan this with the mind Android app, or type the code on the device.
            The code works once and changes when the timer runs out, or when you
            change the name or permissions above.
          </p>
          <p class="sub code-note">Address: <code>${esc(pairingServerUrl())}</code></p>
        </div>
        <div class="pair-actions">
          <button id="devices-pair-cancel">Cancel</button>
        </div>
      </div>`;
  }

  private render(): void {
    const rows = this.devices
      .map((device) => {
        const revoked = device.revokedAt !== null;
        const lastSeen = device.lastSeenAt ? ago(device.lastSeenAt) : "never";
        const name = revoked
          ? esc(device.name)
          : `<span class="device-name" data-device-id="${esc(device.id)}" title="Double-click to rename">${esc(device.name)}</span>`;
        const scopes = revoked
          ? `<td class="meta">${esc(device.scopes.join(", "))}</td>`
          : `<td class="meta device-scopes" data-device-id="${esc(device.id)}" data-scopes="${esc(device.scopes.join(","))}" title="Double-click to change permissions">${esc(device.scopes.join(", "))}</td>`;
        return `
          <tr>
            <td>${name}</td>
            <td>${esc(device.kind)}</td>
            <td title="${esc(device.pairedAt)}">${esc(ago(device.pairedAt))}</td>
            <td${device.lastSeenAt ? ` title="${esc(device.lastSeenAt)}"` : ""}>${revoked ? "revoked" : esc(lastSeen)}</td>
            ${scopes}
            <td>
              ${
                revoked
                  ? ""
                  : `<button data-action="revoke" data-device-id="${esc(device.id)}">Revoke</button>`
              }
            </td>
          </tr>`;
      })
      .join("");

    const table = this.devices.length
      ? `<table>
          <thead><tr><th>Name</th><th>Kind</th><th>Paired</th><th>Last seen</th><th>Permissions</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<div class="empty">No device is paired yet.</div>`;

    const error = this.error ? `<div class="notice danger">${esc(this.error)}</div>` : "";

    const body = `
      ${error}
      <div class="toolbar" style="margin-bottom:0.5em;">
        <p class="sub" style="margin:0;">Paired clients</p>
        <button data-action="refresh">Refresh</button>
        ${this.adding ? "" : '<button id="devices-add">+ Add new Device</button>'}
      </div>
      ${table}
      ${this.adding ? this.pairForm() : ""}
    `;

    this.panel.webview.html = this.shell(
      "Devices",
      body,
      DEVICES_STYLE,
      `var ALL_SCOPES = ${JSON.stringify(SCOPES)};\n${DEVICES_SCRIPT}`,
    );
  }
}

function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 80) : "";
}

function cleanScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const given = new Set(raw.filter((s): s is string => typeof s === "string"));
  return SCOPES.filter((scope) => given.has(scope));
}
