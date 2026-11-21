import { apiFetch } from "./api-client.js";
import { ago } from "./format.js";
import { esc, SectionPanel } from "./webview-base.js";

/**
 * Devices — the clients paired to this server, and pairing a new one.
 *
 * This is the real device registry now, not the earlier preview. Starting a
 * pairing picks a name and permissions here and shows a six-digit code; the
 * phone enters it and receives its own token. Only this editor's master token
 * can list, pair or revoke (the server refuses device tokens on /devices*), so
 * a lost phone cannot revoke the others. Revoking takes effect on that device's
 * next request because auth looks the token up every time.
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

const DEVICES_STYLE = `
  .pair-form { border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 14px 16px; margin-top: 12px; }
  .pair-form label.field { display: block; margin: 10px 0 4px; font-size: 0.85em; opacity: 0.8; }
  .pair-form input[type="text"] { width: 100%; max-width: 360px; }
  .scope-options { display: flex; gap: 14px; flex-wrap: wrap; margin: 6px 0 0; }
  .scope-options label { display: flex; gap: 5px; align-items: center; font-size: 0.9em; }
  .pair-actions { display: flex; gap: 8px; margin-top: 14px; }
  .code-note { text-align: center; margin-top: 6px; }
`;

const DEVICES_SCRIPT = `
  var start = document.getElementById('devices-pair-start');
  if (start) start.addEventListener('click', function () {
    var nameEl = document.getElementById('devices-pair-name');
    var name = nameEl && nameEl.value ? nameEl.value : 'New device';
    var scopes = Array.prototype.slice.call(document.querySelectorAll('#devices-pair-scopes input:checked')).map(function (el) { return el.value; });
    post({ command: 'start-pairing', name: name, scopes: scopes });
  });
  var cancel = document.getElementById('devices-pair-cancel');
  if (cancel) cancel.addEventListener('click', function () { post({ command: 'cancel-pairing' }); });
`;

export class DevicesPanel extends SectionPanel {
  private static current: DevicesPanel | undefined;

  private devices: readonly DeviceRow[] = [];
  private pairing: PairingStart | null = null;
  private error: string | null = null;

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
  }

  protected onMessage(msg: unknown): void {
    void this.handle(msg);
  }

  private async handle(msg: unknown): Promise<void> {
    if (typeof msg !== "object" || msg === null) return;
    const data = msg as Record<string, unknown>;
    const command = data["command"];

    if (command === "start-pairing") {
      const rawName = data["name"];
      const name =
        typeof rawName === "string" && rawName.trim().length > 0
          ? rawName.trim().slice(0, 80)
          : "New device";
      const scopes = Array.isArray(data["scopes"])
        ? data["scopes"].filter(
            (s): s is string => typeof s === "string" && (SCOPES as readonly string[]).includes(s),
          )
        : [];
      if (scopes.length === 0) {
        this.error = "Pick at least one permission for the device.";
        this.render();
        return;
      }
      try {
        this.pairing = await apiFetch<PairingStart>("/devices/pairing", {
          method: "POST",
          body: JSON.stringify({ name, kind: "android", scopes }),
        });
        this.error = null;
      } catch (err) {
        this.error = String(err);
      }
      this.render();
      return;
    }

    if (command === "cancel-pairing") {
      this.pairing = null;
      this.render();
      return;
    }

    if (command === "refresh") {
      await this.refresh();
      return;
    }

    if (command === "revoke") {
      const deviceId = data["deviceId"];
      if (typeof deviceId !== "string") return;
      try {
        await apiFetch(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
        this.pairing = null;
        this.error = null;
        await this.refresh(false);
      } catch (err) {
        this.error = String(err);
        this.render();
      }
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

  private startPanel(): string {
    const options = SCOPES.map(
      (scope) => `
        <label>
          <input type="checkbox" value="${esc(scope)}" ${scope === "read" || scope === "capture" ? "checked" : ""}>
          ${esc(scope)}
        </label>`,
    ).join("");

    return `
      <div class="pair-form">
        <label class="field" for="devices-pair-name">Device name</label>
        <input type="text" id="devices-pair-name" value="My Android phone" maxlength="80">
        <label class="field">Permissions for this device</label>
        <div class="scope-options" id="devices-pair-scopes">${options}</div>
        <p class="sub" style="margin-bottom:0;">
          A new phone defaults to read + capture, the least it needs to show the
          Queue and add a thought. Send lets it approve a drafted reply; settings
          lets it change rules and shared state.
        </p>
        <div class="pair-actions">
          <button id="devices-pair-start">Show pairing code</button>
        </div>
      </div>`;
  }

  private pairingPanel(pairing: PairingStart): string {
    const code = pairing.code;
    const shown = `${esc(code.slice(0, 3))} ${esc(code.slice(3))}`;
    const expires = new Date(pairing.expiresAt);
    const expiry = Number.isNaN(expires.getTime()) ? "shortly" : expires.toLocaleTimeString();

    return `
      <div class="pairing-panel">
        <div class="pairing-code">${shown}</div>
        <p class="sub code-note">
          Enter this code on <strong>${esc(pairing.name)}</strong> in the mind
          Android app before ${esc(expiry)}. The device receives its own token;
          this code works once and is not stored in readable form.
        </p>
        <p class="sub code-note">Permissions: ${esc(pairing.scopes.join(", "))}</p>
        <div class="pair-actions" style="justify-content:center;">
          <button id="devices-pair-cancel">Cancel</button>
        </div>
      </div>`;
  }

  private render(): void {
    const rows = this.devices
      .map((device) => {
        const revoked = device.revokedAt !== null;
        const lastSeen = device.lastSeenAt ? ago(device.lastSeenAt) : "never";
        return `
          <tr>
            <td>${esc(device.name)}</td>
            <td>${esc(device.kind)}</td>
            <td>${esc(new Date(device.pairedAt).toLocaleDateString())}</td>
            <td>${revoked ? "revoked" : esc(lastSeen)}</td>
            <td class="meta">${esc(device.scopes.join(", "))}</td>
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
      <div class="notice">
        A paired device is another client for <strong>you</strong>, not a second
        account. It gets its own credential and the permissions chosen here, and
        shares this server's settings, Queue and Journal. Revoking it locks it
        out on its next request and leaves every other client alone.
      </div>
      <div class="toolbar" style="margin-bottom:0.5em;">
        <p class="sub" style="margin:0;">Paired clients</p>
        <button data-action="refresh">Refresh</button>
      </div>
      ${table}
      ${this.pairing ? this.pairingPanel(this.pairing) : this.startPanel()}
    `;

    this.panel.webview.html = this.shell("Devices", body, DEVICES_STYLE, DEVICES_SCRIPT);
  }
}
