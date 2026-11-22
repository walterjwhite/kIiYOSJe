import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.mind.android"
    // Compose 1.13 needs the 37.1 or later platform. targetSdk stays at the major API level.
    compileSdk {
        version = release(37) {
            minorApiLevel = 2
        }
    }
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "dev.mind.android"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    lint {
        // CI runs :app:lintDebug, so a warning fails the build just like an error.
        warningsAsErrors = true

        // Dependency freshness is not a gate: lint reports every release the day
        // it ships, and AGENTS.md makes dependency upgrades a separate, approved
        // change. Bump versions deliberately, not to silence a warning.
        disable += "GradleDependency"

        // Same reasoning for the target API level: lint starts reporting
        // OldTargetApi the day a newer Android release ships, which turned a
        // passing build red with no change in this repository. Raising targetSdk
        // changes runtime behavior and needs a test on a device, so it is its own
        // change, not a lint fix.
        disable += "OldTargetApi"

        // The server speaks plain HTTP on a private address, and Android cannot
        // scope cleartext permission by CIDR range, so the base config permits it
        // by design. The tradeoff and the VPN/HTTPS guidance are documented in
        // android/README.md#network-security.
        disable += "InsecureBaseConfiguration"

        // The themed icon is in mipmap-anydpi-v33 (Android 13+), because AAPT
        // rejects a <monochrome> layer in a folder that allows API 26-32. This
        // check reads only the base mipmap-anydpi file and ignores the version
        // override, so it fires even though themed icons do work on 13+.
        disable += "MonochromeLauncherIcon"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.11.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    // Scanning the pairing QR code. The embedded ZXing activity does the camera
    // preview, permission prompt and decoding, which keeps the app's own UI a
    // text field and a button.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    // JVM unit tests only; neither ships in the APK. The android.jar stub for
    // org.json throws, so the tests run against the real implementation.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
