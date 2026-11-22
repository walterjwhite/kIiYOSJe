// Android Gradle plugin 9 compiles Kotlin itself (built-in Kotlin), so the
// org.jetbrains.kotlin.android plugin is gone. It brings Kotlin Gradle plugin
// 2.2.10; the Compose compiler plugin must match the Kotlin version, so the
// newer Kotlin Gradle plugin is put on the build classpath here.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.5.2" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}
