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

Open `android/` in Android Studio (Ladybug or newer), or with JDK 17+. The
committed Gradle wrapper downloads the pinned Gradle 8.11.1, so nothing else
needs installing.

The quickest path is the deploy script. It finds the JDK, the Android SDK and
the device (or takes `JAVA_HOME` / `ANDROID_HOME` / `--serial`), builds, installs
over the existing app (keeping the paired token) and launches it:

```bash
./deploy-debug.sh                 # build, install, launch on the connected phone
./deploy-debug.sh --build-only    # just the APK, no phone needed
```

By hand the same two steps are:

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The APK lands in `app/build/outputs/apk/debug/`. Minimum SDK 26, target 35.
The Gradle and Compose versions are pinned in `build.gradle.kts`; update them
together when the toolchain moves.

Unit tests cover what the phone does with a payload — parsing the Queue and the
pairing response — and run on the JVM, so they need no device:

```bash
./gradlew :app:testDebugUnitTest
```

Android lint runs the same way and is configured with `warningsAsErrors = true`
in `app/build.gradle.kts`, so a warning fails the build exactly like an error:

```bash
./gradlew :app:lintDebug          # report: app/build/reports/lint-results-debug.html
```

Three checks are deliberately off, each with its reason in the same `lint` block:
`GradleDependency` (lint flags every new release immediately, and upgrades are a
separate change), `InsecureBaseConfiguration` (cleartext on a private network is
the documented tradeoff below) and `MonochromeLauncherIcon` (the themed icon
lives in `mipmap-anydpi-v33`, but the check only reads the base icon file).
Everything else must be clean.

CI runs lint, those tests and the debug build on every pull request and main
push: the `android` job in `.github/workflows/ci.yml` uses JDK 21, the committed
Gradle wrapper (8.11.1) and SDK 35, and uploads the APK as the
`android-debug-apk` artifact. It is a lint, compile and unit-test check, not a
run on a device or emulator.

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
