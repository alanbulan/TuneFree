pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    // 8.13.2 是 8.x 末版。不要上 AGP 9：Flutter 的 Gradle 插件是按 AGP 8.11.1
    // 编译的（packages/flutter_tools/gradle/build.gradle.kts 里是 compileOnly），
    // AGP 9 的接口化 DSL 会让 FlutterPlugin.addFlutterTasks 抛 ClassCastException
    // （flutter/flutter#192111），且 AGP 9 内置的 Kotlin 2.2.10 低于 Flutter 要求的
    // 2.2.20（flutter/flutter#192167）。留在 8.x 还能让「迁移到 built-in Kotlin」
    // 那条破坏性变更完全不适用。
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
}

include(":app")
