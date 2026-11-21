plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.mind.android"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "dev.mind.android"
        minSdk = 26
        targetSdk = 35
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

    kotlinOptions {
        jvmTarget = "17"
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
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    // JVM unit tests only; neither ships in the APK. The android.jar stub for
    // org.json throws, so the tests run against the real implementation.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
