#!/usr/bin/env bash
# deploy-debug.sh — build the debug APK, install it on a connected phone, launch it.
#
# Usage:
#   ./deploy-debug.sh                      # build, install, launch
#   ./deploy-debug.sh --build-only         # build only; no phone required
#   ./deploy-debug.sh --serial R58M1234AB  # choose among several devices
#   ./deploy-debug.sh --local              # also adb reverse the server port over USB
#
# Environment overrides (all optional):
#   MIND_PORT             server port --local forwards (default 8787)
#   JAVA_HOME             JDK root (auto-detected if unset)
#   ANDROID_HOME          Android SDK root, or ANDROID_SDK_ROOT (auto-detected)
#   ADB_SERIAL            target device serial (ANDROID_SERIAL also works)
#   GRADLE                Gradle command (defaults to ./gradlew, then gradle)
#   ANDROID_PACKAGE_NAME  application id (auto-detected from the Gradle file)
#   ANDROID_MAIN_ACTIVITY launcher activity (auto-detected from the manifest)

set -euo pipefail

# ── 0. Resolve project directory ─────────────────────────────────────────────

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_ONLY=0
LOCAL=0
MIND_PORT="${MIND_PORT:-8787}"
SERIAL="${ADB_SERIAL:-${ANDROID_SERIAL:-}}"

while [ $# -gt 0 ]; do
    case "$1" in
        --build-only) BUILD_ONLY=1 ;;
        --local) LOCAL=1 ;;
        --serial)
            SERIAL="${2:-}"
            if [ -z "$SERIAL" ]; then
                echo "Error: --serial needs a device serial." >&2
                exit 2
            fi
            shift
            ;;
        -h | --help)
            # Print the header comment block, without hard-coding how long it is.
            awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        -*)
            echo "Error: unknown option: $1" >&2
            exit 2
            ;;
        *) PROJECT_DIR="$1" ;;
    esac
    shift
done

# Fail on a bad port before doing any work, device or not.
if [ "$LOCAL" -eq 1 ]; then
    if ! [[ "$MIND_PORT" =~ ^[0-9]+$ ]] || [ "$MIND_PORT" -lt 1 ] || [ "$MIND_PORT" -gt 65535 ]; then
        echo "Error: MIND_PORT must be a TCP port (1-65535), got '$MIND_PORT'." >&2
        exit 2
    fi
fi

if [ ! -d "$PROJECT_DIR" ]; then
    echo "Error: directory not found: $PROJECT_DIR" >&2
    exit 1
fi
cd "$PROJECT_DIR"

echo "==> Project: $PROJECT_DIR"

# ── 1. Locate the Gradle command ─────────────────────────────────────────────

if [ -z "${GRADLE:-}" ]; then
    if [ -x ./gradlew ]; then
        GRADLE=./gradlew
    elif command -v gradle >/dev/null 2>&1; then
        GRADLE=$(command -v gradle)
    else
        echo "Error: no ./gradlew in $PROJECT_DIR and no gradle on PATH." >&2
        echo "The wrapper is normally committed; restore it, or install Gradle 9.9.2" >&2
        echo "and run 'gradle wrapper --gradle-version 8.11.1' to recreate it." >&2
        exit 1
    fi
fi
echo "==> Gradle: $GRADLE"

# ── 2. Locate JAVA_HOME ──────────────────────────────────────────────────────
# Android Gradle Plugin 8 needs JDK 17 or newer. A NixOS box often has no java
# on PATH and no ~/.nix-profile JDK link — only /nix/store entries, which also
# include openjdk-8. So candidates are read for their version and the newest
# suitable one wins, rather than taking the first path that happens to exist.

# Print the major version of a JDK root, or 0 if it cannot be read.
jdk_major() {
    local version=""
    if [ -f "$1/release" ]; then
        version=$(sed -n 's/^JAVA_VERSION="\([0-9][0-9._]*\).*/\1/p' "$1/release" | head -1)
    fi
    if [ -z "$version" ] && [ -x "$1/bin/java" ]; then
        version=$("$1/bin/java" -version 2>&1 \
            | sed -n 's/.*version "\([0-9][0-9._]*\).*/\1/p' | head -1 || true)
    fi
    if [ -z "$version" ]; then
        echo 0
        return 0
    fi
    version="${version#1.}"   # legacy 1.8.0_514 -> 8.0_514
    echo "${version%%[._]*}"
}

# Print the newest JDK root at version 17+ among the arguments, or nothing.
pick_jdk() {
    local best="" best_major=0 candidate major
    for candidate in "$@"; do
        [ -n "$candidate" ] || continue
        [ -x "$candidate/bin/java" ] || continue
        major=$(jdk_major "$candidate")
        [ "$major" -ge 17 ] 2>/dev/null || continue
        if [ "$major" -gt "$best_major" ]; then
            best="$candidate"
            best_major="$major"
        fi
    done
    if [ -n "$best" ]; then
        printf '%s\n' "$best"
    fi
    return 0
}

PATH_JAVA_ROOT=""
if command -v java >/dev/null 2>&1; then
    # java lives in $JAVA_HOME/bin, so two levels up is the JDK root.
    PATH_JAVA_ROOT=$(dirname "$(dirname "$(command -v java)")")
fi

JDK_ROOT=""
if [ -n "${JAVA_HOME:-}" ]; then
    JDK_ROOT="$JAVA_HOME"
else
    JDK_ROOT=$(pick_jdk \
        "$PATH_JAVA_ROOT" \
        /run/current-system/sw/lib/openjdk \
        "$HOME/.nix-profile/lib/openjdk" \
        "/etc/profiles/per-user/${USER:-nobody}/lib/openjdk" \
        /nix/var/nix/profiles/default/lib/openjdk \
        /nix/store/*openjdk*/lib/openjdk \
        "$HOME/.jdks"/* \
        /usr/lib/jvm/* \
        /opt/java/* \
        /opt/openjdk \
        "$HOME/Android/Android Studio/jbr" \
        /opt/android-studio/jbr)
    if [ -z "$JDK_ROOT" ] && command -v /usr/libexec/java_home >/dev/null 2>&1; then
        JDK_ROOT=$(pick_jdk "$(/usr/libexec/java_home 2>/dev/null || true)")
    fi
fi

if [ -z "$JDK_ROOT" ] || [ ! -x "$JDK_ROOT/bin/java" ]; then
    echo "Error: could not find a usable JDK (Android Gradle Plugin 8 needs JDK 17 or newer)." >&2
    if [ -n "$PATH_JAVA_ROOT" ]; then
        echo "The java on PATH is $(jdk_major "$PATH_JAVA_ROOT") ($PATH_JAVA_ROOT)." >&2
    fi
    echo "Set JAVA_HOME to a JDK 17+ root. On NixOS, either of these works:" >&2
    echo "  nix shell nixpkgs#jdk21 && ./deploy-debug.sh" >&2
    echo "  export JAVA_HOME=\$(dirname \"\$(dirname \"\$(readlink -f \"\$(command -v javac)\")\")\")" >&2
    exit 1
fi

JDK_MAJOR=$(jdk_major "$JDK_ROOT")
if [ "$JDK_MAJOR" != "0" ] && [ "$JDK_MAJOR" -lt 17 ]; then
    echo "Error: JAVA_HOME is JDK $JDK_MAJOR ($JDK_ROOT); Android Gradle Plugin 8 needs JDK 17 or newer." >&2
    exit 1
fi

export JAVA_HOME="$JDK_ROOT"
export PATH="$JAVA_HOME/bin:$PATH"
echo "==> JAVA_HOME: $JAVA_HOME (JDK ${JDK_MAJOR})"

# ── 3. Locate the Android SDK and adb ────────────────────────────────────────

if [ -z "${ANDROID_HOME:-}" ] && [ -f ./local.properties ]; then
    ANDROID_HOME=$(
        sed -n 's/^sdk\.dir=\(.*\)$/\1/p' ./local.properties | tail -1
    )
fi

if [ -z "${ANDROID_HOME:-}" ]; then
    for candidate in \
        "${ANDROID_SDK_ROOT:-}" \
        "$HOME/Android/Sdk" \
        "$HOME/Library/Android/sdk" \
        /opt/android-sdk \
        /usr/lib/android-sdk; do
        if [ -n "$candidate" ] && [ -d "$candidate" ]; then
            ANDROID_HOME="$candidate"
            break
        fi
    done
fi

if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
    echo "Error: ANDROID_HOME is not set and the SDK could not be auto-detected." >&2
    exit 1
fi
export ANDROID_HOME
echo "==> ANDROID_HOME: $ANDROID_HOME"

export PATH="$ANDROID_HOME/platform-tools:$PATH"

if ! command -v adb >/dev/null 2>&1; then
    echo "Error: adb not found in $ANDROID_HOME/platform-tools" >&2
    echo "Install it with: sdkmanager 'platform-tools'" >&2
    exit 1
fi

# ── 4. Pick a device ─────────────────────────────────────────────────────────

ADB=adb
if [ "$BUILD_ONLY" -eq 0 ]; then
    echo "==> Checking for a connected device..."
    if [ -n "$SERIAL" ]; then
        ADB="adb -s $SERIAL"
    fi

    if [ "$SERIAL" = "" ]; then
        DEVICES=$(adb devices | awk -F'\t' '$2 == "device" {print $1}')
        if [ -z "$DEVICES" ]; then
            echo "Error: no authorised Android device found." >&2
            echo "Enable USB debugging, approve the prompt on the phone, then retry." >&2
            echo "Run 'adb devices' to see the current state." >&2
            exit 1
        fi
        COUNT=$(printf '%s\n' "$DEVICES" | wc -l | tr -d ' ')
        if [ "$COUNT" -gt 1 ]; then
            SERIAL=$(printf '%s\n' "$DEVICES" | head -1)
            echo "Multiple devices; using $SERIAL (override with --serial or ADB_SERIAL)."
        else
            SERIAL="$DEVICES"
        fi
        ADB="adb -s $SERIAL"
    fi

    if ! ${ADB} get-state >/dev/null 2>&1; then
        echo "Error: device '$SERIAL' is not available to adb." >&2
        exit 1
    fi
    echo "==> Device: $SERIAL"
fi

# ── 5. Forward the server port over USB (--local) ────────────────────────────
# 'adb reverse' makes 127.0.0.1:<port> on the phone reach this machine, so the
# phone can pair from the QR code without the server binding to the network.

if [ "$LOCAL" -eq 1 ]; then
    if [ "$BUILD_ONLY" -eq 1 ]; then
        echo "Note: --local needs a phone; skipped for --build-only." >&2
    else
        echo ""
        echo "==> Forwarding tcp:$MIND_PORT to this machine over USB..."
        ${ADB} reverse "tcp:$MIND_PORT" "tcp:$MIND_PORT"
        echo "==> The phone now reaches http://127.0.0.1:$MIND_PORT here."
    fi
fi

# ── 6. Auto-detect the application id ────────────────────────────────────────

PACKAGE_NAME="${ANDROID_PACKAGE_NAME:-}"

if [ -z "$PACKAGE_NAME" ]; then
    for file in app/build.gradle.kts app/build.gradle; do
        [ -f "$file" ] || continue
        PACKAGE_NAME=$(sed -n 's/.*applicationId[[:space:]]*=\?[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -1)
        [ -n "$PACKAGE_NAME" ] && break
    done
fi

if [ -z "$PACKAGE_NAME" ] && [ -f app/src/main/AndroidManifest.xml ]; then
    PACKAGE_NAME=$(sed -n 's/.*package="\([^"]*\)".*/\1/p' app/src/main/AndroidManifest.xml | head -1)
fi

if [ -z "$PACKAGE_NAME" ]; then
    echo "Error: could not determine the application id." >&2
    echo "Set ANDROID_PACKAGE_NAME=<your.package> and retry." >&2
    exit 1
fi
echo "==> Package: $PACKAGE_NAME"

# ── 7. Auto-detect the launcher activity ─────────────────────────────────────

MAIN_ACTIVITY="${ANDROID_MAIN_ACTIVITY:-}"

if [ -z "$MAIN_ACTIVITY" ] && [ -f app/src/main/AndroidManifest.xml ]; then
    # Collapse the manifest to one line, split at each <activity so every line
    # holds exactly one activity block, keep the block that declares MAIN, reduce
    # it to its opening tag (a later <category> also has an android:name), then
    # read the name from that tag.
    MAIN_ACTIVITY=$(tr '\n' ' ' < app/src/main/AndroidManifest.xml \
        | sed 's/<activity/\n<activity/g' \
        | grep -F 'android.intent.action.MAIN' \
        | sed -n 's/^\(<activity[^>]*>\).*/\1/p' \
        | sed -n 's/.*android:name="\([^"]*\)".*/\1/p' \
        | head -1 || true)
fi

if [[ "$MAIN_ACTIVITY" == .* ]]; then
    MAIN_ACTIVITY="${PACKAGE_NAME}${MAIN_ACTIVITY}"
fi

if [ -z "$MAIN_ACTIVITY" ]; then
    echo "Warning: could not detect the launcher activity; the launch step will be skipped." >&2
fi
echo "==> Activity: ${MAIN_ACTIVITY:-<unknown>}"

# ── 8. Build ────────────────────────────────────────────────────────────────

echo ""
echo "==> Building the debug APK..."
"$GRADLE" assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK_PATH" ]; then
    echo "Error: the build finished but no APK is at $APK_PATH" >&2
    exit 1
fi
echo "==> APK: $APK_PATH"

if [ "$BUILD_ONLY" -eq 1 ]; then
    echo ""
    echo "Done — built without installing (--build-only)."
    exit 0
fi

# ── 9. Install ──────────────────────────────────────────────────────────────

echo ""
echo "==> Installing..."
# -r keeps app data (the paired token survives), -d allows a version downgrade.
${ADB} install -r -d "$APK_PATH"

# ── 10. Launch ──────────────────────────────────────────────────────────────

if [ -n "$MAIN_ACTIVITY" ]; then
    echo ""
    echo "==> Launching $MAIN_ACTIVITY..."
    ${ADB} shell am start -W -n "${PACKAGE_NAME}/${MAIN_ACTIVITY}" >/dev/null
    echo ""
    echo "Done. First run: in VS Code open mind → Devices → Show pairing code,"
    echo "then scan the QR code with the phone — it carries the server address"
    echo "and the six digits."
    if [ "$LOCAL" -eq 1 ]; then
        echo "The port is forwarded, so the address should be http://127.0.0.1:$MIND_PORT"
        echo "(set mind.pairingServerUrl to that if the QR code shows a LAN address)."
    else
        echo "For a server on this machine over USB, rerun with --local to forward"
        echo "tcp:$MIND_PORT and pair to http://127.0.0.1:$MIND_PORT without binding the"
        echo "server to the network."
    fi
else
    echo ""
    echo "Done — installed. Launch it manually or set ANDROID_MAIN_ACTIVITY."
fi
