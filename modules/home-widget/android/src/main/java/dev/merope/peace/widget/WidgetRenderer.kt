package dev.merope.peace.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Draws both widgets from the stored snapshot.
 *
 * ARRANGES, NEVER DECIDES. What may be shown — masked or not, figures or none —
 * was settled by `src/lib/widget.ts` before the snapshot was written. This
 * answers only what changes while the app is closed: whether the snapshot's
 * month has ENDED (then it must not pose as the current one), and how many
 * days are left in it. Both depend on the clock, so one inexact alarm redraws
 * at the next local midnight or the month's end, whichever is first.
 *
 * COLOURS. Backgrounds and icons are white drawables tinted with
 * `setColorFilter`, the colour call RemoteViews allows on every supported
 * Android. On "Match phone" Android 12+ takes BOTH palettes (`setColorInt`
 * with a day and a night value) and switches with the phone's dark mode by
 * itself, with the app closed; older Android gets the palette for the mode the
 * phone is in when it draws.
 */
internal object WidgetRenderer {
  const val ACTION_REFRESH = "dev.merope.peace.widget.REFRESH"
  private const val DAY = 86_400_000L
  private const val TAG = "PeaceWidget"

  private class Palette(o: JSONObject) {
    val surface = color(o, "surface")
    val raised = color(o, "raised")
    val ink = color(o, "ink")
    val muted = color(o, "muted")
    val accent = color(o, "accent")
    val accentInk = color(o, "accentInk")
    val income = color(o, "income")
    val expense = color(o, "expense")

    private fun color(o: JSONObject, key: String) = Color.parseColor(o.getString(key))
  }

  private class Theme(val system: Boolean, val light: Palette, val dark: Palette)

  private class Figures(o: JSONObject) {
    val amount: String = o.getString("amount")
    val tone: String = o.getString("tone")
    val beside: String = o.getString("beside")
    val bar: Double? = o.optJSONObject("bar")?.getDouble("fraction")
    val over: Boolean = o.optJSONObject("bar")?.optBoolean("over") ?: false
    val foot: String = o.getString("foot")
    val daysLeft: Boolean = o.optBoolean("daysLeft")
  }

  private class Snapshot(o: JSONObject) {
    val month: String = o.getString("month")
    val endsAt: Long = o.getLong("endsAt")
    val figures: Figures? = o.optJSONObject("figures")?.let { Figures(it) }
    val theme: Theme =
      o.getJSONObject("theme").let {
        Theme(it.getBoolean("system"), Palette(it.getJSONObject("light")), Palette(it.getJSONObject("dark")))
      }
  }

  fun updateAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val snapshot = load(context)
    val now = System.currentTimeMillis()
    val night = phoneIsNight()

    val monthIds = manager.getAppWidgetIds(ComponentName(context, MonthWidgetProvider::class.java))
    if (monthIds.isNotEmpty()) {
      manager.updateAppWidget(monthIds, month(context, snapshot, now, night))
      scheduleRefresh(context, snapshot?.endsAt, now)
    } else {
      cancelRefresh(context)
    }

    val quickIds = manager.getAppWidgetIds(ComponentName(context, QuickWidgetProvider::class.java))
    if (quickIds.isNotEmpty()) manager.updateAppWidget(quickIds, quick(context, snapshot, night))
  }

  /** A snapshot that cannot be read is no snapshot: the widget asks to be opened. */
  private fun load(context: Context): Snapshot? {
    val json = WidgetStore.read(context) ?: return null
    return try {
      Snapshot(JSONObject(json))
    } catch (e: Exception) {
      Log.w(TAG, "unreadable widget snapshot", e)
      null
    }
  }

  // ---------------------------------------------------------------- month --

  private fun month(context: Context, s: Snapshot?, now: Long, night: Boolean): RemoteViews {
    val rv = RemoteViews(context.packageName, R.layout.peace_widget_month)
    val paint = Painter(rv, s?.theme, night)
    clicks(context, rv)
    paint.tint(R.id.widget_bg) { it.surface }
    paint.text(R.id.month) { it.muted }
    paint.tint(R.id.wordmark) { it.accent }
    buttons(paint)

    when {
      s == null -> {
        rv.setTextViewText(R.id.month, "This month")
        notice(rv, paint, R.drawable.peace_widget_calendar, "Open Peace once to show this month here.")
      }
      // A month that has ended is not this month. Its figures would be read
      // as today's, so they are not shown at all until the app writes again.
      now >= s.endsAt -> {
        rv.setTextViewText(R.id.month, "New month")
        notice(rv, paint, R.drawable.peace_widget_calendar, "A new month has started. Open Peace to update.")
      }
      s.figures == null -> {
        rv.setTextViewText(R.id.month, s.month)
        notice(rv, paint, R.drawable.peace_widget_lock, "Peace is locked. Open it to see this month.")
      }
      else -> {
        rv.setTextViewText(R.id.month, s.month)
        figures(rv, paint, s.figures, s.endsAt, now)
      }
    }
    return rv
  }

  private fun figures(rv: RemoteViews, paint: Painter, f: Figures, endsAt: Long, now: Long) {
    rv.setViewVisibility(R.id.figures, View.VISIBLE)
    rv.setViewVisibility(R.id.notice, View.GONE)

    rv.setTextViewText(R.id.amount, f.amount)
    paint.text(R.id.amount) {
      when (f.tone) {
        "income" -> it.income
        "expense" -> it.expense
        else -> it.ink
      }
    }
    rv.setTextViewText(R.id.beside, f.beside)
    paint.text(R.id.beside) { it.muted }
    rv.setTextViewText(R.id.foot, if (f.daysLeft) "${f.foot} · ${daysLeft(now, endsAt)}" else f.foot)
    paint.text(R.id.foot) { it.muted }

    val fraction = f.bar
    if (fraction == null) {
      rv.setViewVisibility(R.id.bar_holder, View.GONE)
      return
    }
    rv.setViewVisibility(R.id.bar_holder, View.VISIBLE)
    paint.bar(fraction, f.over)
  }

  private fun notice(rv: RemoteViews, paint: Painter, icon: Int, text: String) {
    rv.setViewVisibility(R.id.figures, View.GONE)
    rv.setViewVisibility(R.id.notice, View.VISIBLE)
    rv.setImageViewResource(R.id.notice_icon, icon)
    paint.tint(R.id.notice_icon) { it.muted }
    rv.setTextViewText(R.id.notice_text, text)
    paint.text(R.id.notice_text) { it.ink }
  }

  /** Counted at draw time, in local days: "16 days to go" on the 15th of October. */
  private fun daysLeft(now: Long, endsAt: Long): String {
    val days = ((startOfDay(endsAt - 1) - startOfDay(now)).toDouble() / DAY).roundToInt()
    return when {
      days <= 0 -> "last day"
      days == 1 -> "1 day to go"
      else -> "$days days to go"
    }
  }

  // ---------------------------------------------------------------- quick --

  private fun quick(context: Context, s: Snapshot?, night: Boolean): RemoteViews {
    val rv = RemoteViews(context.packageName, R.layout.peace_widget_quick)
    val paint = Painter(rv, s?.theme, night)
    clicks(context, rv)
    paint.tint(R.id.widget_bg) { it.surface }
    buttons(paint)
    return rv
  }

  // --------------------------------------------------------------- shared --

  private fun buttons(paint: Painter) {
    paint.tint(R.id.btn_expense_bg) { it.accent }
    paint.tint(R.id.btn_expense_icon) { it.accentInk }
    paint.text(R.id.btn_expense_label) { it.accentInk }
    paint.tint(R.id.btn_receipt_bg) { it.raised }
    paint.tint(R.id.btn_receipt_icon) { it.ink }
    paint.tint(R.id.btn_penny_bg) { it.raised }
    paint.tint(R.id.btn_penny_icon) { it.ink }
  }

  /**
   * The same links as the launcher shortcuts, each naming its package: both
   * builds register `peace://`, and a bare link would open a chooser — or the
   * other app — on a phone that has the GitHub build and the Play one.
   */
  private fun clicks(context: Context, rv: RemoteViews) {
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      rv.setOnClickPendingIntent(R.id.widget_root, activity(context, it, 0))
    }
    rv.setOnClickPendingIntent(R.id.btn_expense, link(context, "peace://record", 1))
    rv.setOnClickPendingIntent(R.id.btn_receipt, link(context, "peace://record?capture=1", 2))
    rv.setOnClickPendingIntent(R.id.btn_penny, link(context, "peace://assistant", 3))
  }

  private fun link(context: Context, uri: String, code: Int): PendingIntent =
    activity(context, Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName), code)

  private fun activity(context: Context, intent: Intent, code: Int): PendingIntent =
    PendingIntent.getActivity(
      context,
      code,
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  /**
   * The PHONE's dark mode, not the app's. The app forces its own night mode to
   * match its theme, which colours its own configuration; the system
   * resources carry what the home screen is actually showing.
   */
  private fun phoneIsNight(): Boolean =
    (Resources.getSystem().configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  private fun startOfDay(ms: Long): Long =
    Calendar.getInstance().apply {
      timeInMillis = ms
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }.timeInMillis

  // ---------------------------------------------------------------- alarm --

  /**
   * One inexact, non-waking alarm: a minute past the next local midnight, or
   * past the month's end if that comes first. Nothing on a home screen needs
   * the phone woken for it — RTC fires when it is next awake, which is when
   * anybody could be looking.
   */
  private fun scheduleRefresh(context: Context, endsAt: Long?, now: Long) {
    val midnight = startOfDay(now) + DAY + 60_000
    val at = if (endsAt != null && endsAt > now) minOf(midnight, endsAt + 60_000) else midnight
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    alarms.set(AlarmManager.RTC, at, refreshIntent(context))
  }

  fun cancelRefresh(context: Context) {
    context.getSystemService(AlarmManager::class.java)?.cancel(refreshIntent(context))
  }

  private fun refreshIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      0,
      Intent(context, MonthWidgetProvider::class.java).setAction(ACTION_REFRESH),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  /**
   * Applies a theme's colour to a view. With no snapshot it does nothing, and
   * the layout's own colours (Ledger's) stand.
   */
  private class Painter(val rv: RemoteViews, val theme: Theme?, val night: Boolean) {
    fun text(id: Int, pick: (Palette) -> Int) = color(id, "setTextColor", pick)

    fun tint(id: Int, pick: (Palette) -> Int) = color(id, "setColorFilter", pick)

    private fun color(id: Int, method: String, pick: (Palette) -> Int) {
      val t = theme ?: return
      if (t.system && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        rv.setColorInt(id, method, pick(t.light), pick(t.dark))
      } else {
        rv.setInt(id, method, pick(if (t.system && night) t.dark else t.light))
      }
    }

    /**
     * Android 12+ tints the ProgressBar itself, per mode. Older Android cannot
     * tint one remotely, so it gets a bitmap drawn in the current mode.
     */
    fun bar(fraction: Double, over: Boolean) {
      val t = theme ?: return
      val fill = { p: Palette -> if (over) p.expense else p.accent }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        rv.setViewVisibility(R.id.bar, View.VISIBLE)
        rv.setViewVisibility(R.id.bar_image, View.GONE)
        rv.setProgressBar(R.id.bar, 1000, (fraction * 1000).roundToInt(), false)
        if (t.system) {
          rv.setColorStateList(R.id.bar, "setProgressTintList", csl(fill(t.light)), csl(fill(t.dark)))
          rv.setColorStateList(R.id.bar, "setProgressBackgroundTintList", csl(t.light.raised), csl(t.dark.raised))
        } else {
          rv.setColorStateList(R.id.bar, "setProgressTintList", csl(fill(t.light)))
          rv.setColorStateList(R.id.bar, "setProgressBackgroundTintList", csl(t.light.raised))
        }
      } else {
        val p = if (t.system && night) t.dark else t.light
        rv.setViewVisibility(R.id.bar, View.GONE)
        rv.setViewVisibility(R.id.bar_image, View.VISIBLE)
        rv.setImageViewBitmap(R.id.bar_image, barBitmap(fraction, fill(p), p.raised))
      }
    }

    private fun csl(color: Int) = ColorStateList.valueOf(color)

    private fun barBitmap(fraction: Double, fill: Int, track: Int): Bitmap {
      val w = 600f
      val h = 12f
      val bitmap = Bitmap.createBitmap(w.toInt(), h.toInt(), Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG)
      paint.color = track
      canvas.drawRoundRect(RectF(0f, 0f, w, h), h / 2, h / 2, paint)
      if (fraction > 0) {
        paint.color = fill
        canvas.drawRoundRect(RectF(0f, 0f, max(h, (w * fraction).toFloat()), h), h / 2, h / 2, paint)
      }
      return bitmap
    }
  }
}
