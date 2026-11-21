# mind — Android client

A paired phone client for the local `mind` server: see the Queue, capture a
thought, acknowledge a signal, and — only if the device was granted the `send`
permission — approve or discard a drafted reply. Pairing is the only setup.

This is deliberately not a second inbox. It shares the server's Queue, Journal,
settings and Directions; the server remains the single source of truth. The last
successfully loaded queue is kept on the device and labelled as cached when the
server cannot be reached.

## Pairing (under a minute)

1. Start the server on a machine the phone can reach:

   ```bash
   MIND_BIND_HOST=0.0.0.0 npm run dev
   # the server logs a warning when it is bound beyond loopback
   ```

   Find the machine's private address (`ipconfig getifaddr en0`,
   `hostname -I`, or the router's device list). Keep the port to a trusted
   private network.

2. In VS Code: **mind → Devices**. Pick a name and permissions
   (a phone defaults to `read` + `capture`), then **Show pairing code**.

3. In the app: enter `http://<machine-address>:8787` and the six digits. The app
   exchanges the code for its own token, stored encrypted with a key in the
   Android Keystore.

The code is single-use, expires in ten minutes, and accepts five wrong tries.
Revoke the phone from the same Devices screen; it is locked out on its next
request while every other client keeps working. Unpairing in the app only
forgets the token locally — revoke on the server too.

## Building

Open `android/` in Android Studio (Ladybug or newer), or with a JDK 17 and a
Gradle 8.9+ install:

```bash
cd android
gradle wrapper --gradle-version 8.9   # once, if you want ./gradlew
./gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`. Minimum SDK 26, target 35.
The Gradle and Compose versions are pinned in `build.gradle.kts`; update them
together when the toolchain moves.

**This project has not been built or run in this repository's CI**: there is no
Android SDK in it. Treat the first `assembleDebug` as the build verification.

## Network security

The server normally speaks plain HTTP on a private address. Android's network
security config matches named hosts rather than private CIDR ranges, so the app
permits cleartext (`res/xml/network_security_config.xml`) and relies on the
operator entering a private address. A token sent over cleartext on a shared
network can be observed; for use away from home, put the server behind a VPN
(WireGuard/Tailscale) or an HTTPS reverse proxy rather than exposing port 8787,
and never enter a public HTTP address.

The device token is the whole authorization: it is sent as a bearer token on
every call and the server enforces the granted scopes on each route. It is not
logged, and the app's backup is disabled so it does not ride along to cloud
backup.

## What is not here yet

- Audio brief playback, dictation and offline write queues (TODO.md §2).
- Revoking another device from the phone: device management is master-token
  only, so a lost phone cannot revoke the editor.
- Push notifications: `mind` does not push, by design.
