package dev.merope.peace.nightmode

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Tells Android whether Peace is dark or light, so the NEXT launch's splash is.
 *
 * The splash is drawn by the system before any of our code runs, from
 * resources: `values/` for a light app, `values-night/` for a dark one. Which
 * folder it picks is the system's idea of the app's night mode, and React
 * Native's `Appearance.setColorScheme` cannot reach that — it goes through
 * `AppCompatDelegate.setDefaultNightMode`, which lives in this process and is
 * forgotten when it dies (AppCompat 1.7.1 never calls the method below).
 * `setApplicationNightMode` is the one that is persisted, by the system, per
 * app — so a dark theme chosen today makes tomorrow's cold start dark.
 *
 * Android 12 (API 31) and later only, which is also where the system draws the
 * splash at all; `persist` says so by returning false.
 */
class NightModeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NightMode")

    Function("persist") { scheme: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function false
      val context = appContext.reactContext ?: return@Function false
      val ui = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        ?: return@Function false
      ui.setApplicationNightMode(
        when (scheme) {
          "dark" -> UiModeManager.MODE_NIGHT_YES
          "light" -> UiModeManager.MODE_NIGHT_NO
          else -> UiModeManager.MODE_NIGHT_AUTO
        }
      )
      true
    }
  }
}
