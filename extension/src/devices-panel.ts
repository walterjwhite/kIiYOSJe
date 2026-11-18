import { SectionPanel } from "./webview-base.js";

/**
 * Devices placeholder — PLAN.md §5 ("Several clients, one person") and the
 * future Android app depend on real multi-device pairing and scoped,
 * per-device auth tokens, which conflicts with nothing built yet: PLAN.md's
 * own open decisions defer remote authentication to P6, and there is no
 * second client to pair today. Rather than build that subsystem now for
 * nothing to use, this reuses the mockup's Devices table/pairing-panel
 * layout as a static preview and says plainly that pairing isn't real yet.
 *
 * When the Android app is actually built, this panel is where real pairing
 * (device registry, scoped tokens, revoke-per-device) gets wired in.
 */
export class DevicesPanel extends SectionPanel {
  private static current: DevicesPanel | undefined;

  static show(): void {
    if (DevicesPanel.current) {
      DevicesPanel.current.reveal();
      return;
    }
    DevicesPanel.current = new DevicesPanel();
  }

  private constructor() {
    super("mind.devices", "Devices — mind");
    this.render();
  }

  protected onDispose(): void {
    DevicesPanel.current = undefined;
  }

  protected onMessage(): void {
    /* static preview, nothing to handle yet */
  }

  private render(): void {
    const body = `
      <div class="notice">
        <strong>Development in progress.</strong> Device pairing is not
        implemented yet — this is a preview of the planned layout, not live
        data. Settings, queue, journal, and knowledge belong to you, not the
        device; pairing a device will give it its own credential and a scoped
        set of permissions, and revoking one will be immediate and independent
        of the others (PLAN.md §5). This is also where the eventual Android
        app will be paired, once it exists.
      </div>
      <p class="sub">Paired clients (preview)</p>
      <table>
        <thead><tr><th>Name</th><th>Kind</th><th>Paired</th><th>Last seen</th><th>Scopes</th></tr></thead>
        <tbody>
          <tr>
            <td>This editor (VS Code)</td>
            <td>editor</td>
            <td>—</td>
            <td>now</td>
            <td class="meta">read, capture, send, render, settings</td>
          </tr>
        </tbody>
      </table>
      <button disabled>+ Pair a new device</button>
      <div class="pairing-panel">
        <div class="pairing-code">123 456</div>
        <p class="sub" style="margin-bottom:0;">
          Example only — pairing codes, device scopes, and revocation aren't
          wired to anything real yet.
        </p>
      </div>
    `;

    this.panel.webview.html = this.shell("Devices", body);
  }
}
