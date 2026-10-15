package dev.merope.peace.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * The three widgets. Each one simply asks for everything to be redrawn: one
 * snapshot feeds all of them, so redrawing one alone could leave two placed
 * widgets disagreeing about the same month.
 */
class BudgetWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    WidgetRenderer.updateAll(context)

  override fun onDisabled(context: Context) = WidgetRenderer.updateAll(context)
}

/** Redrawn on resize too: how many accounts fit depends on its real height. */
class BalanceWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    WidgetRenderer.updateAll(context)

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    options: Bundle
  ) = WidgetRenderer.updateAll(context)

  override fun onDisabled(context: Context) = WidgetRenderer.updateAll(context)
}

/** The quick bar alone. No figures, so it never goes stale. */
class QuickWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    WidgetRenderer.updateAll(context)
}

/** The midnight / month-end alarm. Not exported; only our AlarmManager sends it. */
class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) = WidgetRenderer.updateAll(context)
}
