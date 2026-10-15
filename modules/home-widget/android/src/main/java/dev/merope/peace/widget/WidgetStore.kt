package dev.merope.peace.widget

import android.content.Context

/**
 * Where the last snapshot waits for the launcher.
 *
 * A widget is drawn by Android at times the app does not choose — when it is
 * placed, after a reboot, at the alarm WidgetRenderer sets — and none of those
 * have the app running. So the app writes here and the widgets read here, the
 * bank-notification capture store in reverse.
 */
internal object WidgetStore {
  private const val PREFS = "peace_widget"
  private const val KEY = "snapshot"

  fun write(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }

  fun read(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
}
