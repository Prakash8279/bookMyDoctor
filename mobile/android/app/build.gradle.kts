import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing: loads android/key.properties, which points at
// android/upload-keystore.jks. Both files are gitignored — NEVER commit a
// real signing keystore or its passwords to source control. A release build
// must fail if this configuration is absent; signing a distributable APK/AAB
// with the debug key is not a safe production fallback.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasKeystoreProperties = keystorePropertiesFile.exists()
if (hasKeystoreProperties) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

val signingFields = listOf("keyAlias", "keyPassword", "storeFile", "storePassword")
if (hasKeystoreProperties) {
    signingFields.forEach { field ->
        require(!keystoreProperties.getProperty(field).isNullOrBlank()) {
            "android/key.properties is missing required '$field' for release signing."
        }
    }
    require(file(keystoreProperties.getProperty("storeFile")).exists()) {
        "The release keystore configured in android/key.properties was not found."
    }
}

gradle.taskGraph.whenReady {
    val isReleaseBuild = allTasks.any { task ->
        task.name.contains("release", ignoreCase = true)
    }
    if (isReleaseBuild && !hasKeystoreProperties) {
        throw GradleException(
            "Release signing is not configured. Add android/key.properties and the upload keystore before building a release."
        )
    }
}

// Flutter 3.47 generates the Android plugin registrant from every pubspec
// plugin, including dev-only integration_test, but its Gradle loader correctly
// omits dev dependencies from release classpaths. That leaves a dangling Java
// reference and makes a signed release fail to compile. Remove only that
// generated test-plugin registration immediately before release Java compile;
// integration tests remain available to debug/test builds and no test code is
// shipped in the production bundle.
val generatedPluginRegistrant = file("src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java")
val integrationTestRegistrantBlock = Regex(
    """(?s)\s*try \{\s*flutterEngine\.getPlugins\(\)\.add\(new dev\.flutter\.plugins\.integration_test\.IntegrationTestPlugin\(\)\);\s*\} catch \(Exception e\) \{\s*Log\.e\(TAG, \"Error registering plugin integration_test, dev\.flutter\.plugins\.integration_test\.IntegrationTestPlugin\", e\);\s*\}"""
)
var releaseRegistrantSource: String? = null

tasks.matching { it.name == "compileReleaseJavaWithJavac" }.configureEach {
    doFirst {
        if (!generatedPluginRegistrant.exists()) return@doFirst
        val source = generatedPluginRegistrant.readText()
        releaseRegistrantSource = source
        val scrubbed = integrationTestRegistrantBlock.replace(source, "\n")
        if (scrubbed != source) generatedPluginRegistrant.writeText(scrubbed)
    }
    doLast {
        releaseRegistrantSource?.let { source ->
            generatedPluginRegistrant.writeText(source)
        }
        releaseRegistrantSource = null
    }
}

android {
    namespace = "com.bookmydoctor24.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.bookmydoctor24.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasKeystoreProperties) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            if (hasKeystoreProperties) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
