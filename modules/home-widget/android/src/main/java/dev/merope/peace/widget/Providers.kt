package dev.merope.peace.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent

/** "This month": figures, a bar, the quick bar. Redrawn at midnight and month end. */
class MonthWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    WidgetRenderer.updateAll(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == WidgetRenderer.ACTION_REFRESH) {
      WidgetRenderer.updateAll(context)
      return
    }
    super.onReceive(context, intent)
  }

  override fun onDisabled(context: Context) {
    // The last one was removed: nothing left for the alarm to redraw.
    WidgetRenderer.cancelRefresh(context)
  }
}

/** The quick bar alone. No figures, so it never goes stale. */
class QuickWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    WidgetRenderer.updateAll(context)
  }
}
