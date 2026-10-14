package dev.merope.peace.recents

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps the ledger out of the recent-apps preview while the app lock is on.
 *
 * Android snapshots the screen when the app leaves the foreground, BEFORE any
 * JavaScript could draw the lock over it — so a locked Peace would still show
 * last month's spending in the app switcher to whoever picks the phone up.
 * `setRecentsScreenshotEnabled(false)` makes that preview blank and leaves
 * ordinary screenshots alone, which `FLAG_SECURE` would not.
 *
 * Android 13 (API 33) and later only; earlier versions have no switch that
 * spares screenshots, and `setHidden` says so by returning false. The flag
 * belongs to the activity, which Android can recreate, so JS sets it again
 * every time the app comes to the foreground rather than once.
 */
class RecentsPrivacyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RecentsPrivacy")

    Function("setHidden") { hidden: Boolean ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@Function false
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread { activity.setRecentsScreenshotEnabled(!hidden) }
      true
    }
  }
}
