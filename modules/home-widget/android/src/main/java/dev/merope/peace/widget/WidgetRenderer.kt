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
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Draws all three widgets from the one stored snapshot.
 *
 * ARRANGES, NEVER DECIDES. What may be shown — masked or not, figures or none —
 * was settled by `src/lib/widget.ts` before the snapshot was written. This
 * answers only what changes while the app is closed: whether the snapshot's
 * month has ENDED (then it must not pose as the current one), how many days
 * are left in it, and how many accounts fit in a Balance widget's real size.
 * The first two depend on the clock, so one inexact alarm redraws at the next
 * local midnight or the month's end, whichever is first.
 *
 * COLOURS. Backgrounds and icons are white drawables tinted with
 * `setColorFilter`, the colour call RemoteViews allows on every supported
 * Android. On "Match phone" Android 12+ takes BOTH palettes (`setColorInt`
 * with a day and a night value) and switches with the phone's dark mode by
 * itself, with the app closed; older Android gets the palette for the mode the
 * phone is in when it draws.
 */
internal object WidgetRenderer {
  private const val DAY = 86_400_000L
  private const val TAG = "PeaceWidget"

  /**
   * Below this height (dp) the Balance widget is ONE ROW — its default 4×1 —
   * and uses the compact layout: the figure and three round buttons.
   */
  private const val COMPACT_BELOW_DP = 150

  /**
   * In the full layout the header, figure, month line, quick bar and padding
   * take about 162dp; accounts fill the rest, 22dp each at least, and
   * "and N more" is a short 16dp line rather than a row of its own. A Pixel's
   * 4×2 (≈224dp) fits two accounts and that line; 4×3 about six.
   */
  private const val BALANCE_TOP_DP = 162
  private const val ACCOUNT_ROW_DP = 22
  private const val MORE_LINE_DP = 16
  private const val MAX_ACCOUNT_ROWS = 6

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

  private class Budget(o: JSONObject) {
    val amount: String = o.getString("amount")
    val beside: String = o.getString("beside")
    val fraction: Double = o.getJSONObject("bar").getDouble("fraction")
    val over: Boolean = o.getJSONObject("bar").getBoolean("over")
    val foot: String = o.getString("foot")
  }

  private class Balance(o: JSONObject) {
    val amount: String = o.getString("amount")
    val tone: String = o.getString("tone")
    val beside: String = o.getString("beside")
    val foot: String = o.getString("foot")
  }

  private class Account(o: JSONObject) {
    val name: String = o.getString("name")
    val amount: String = o.getString("amount")
    val tone: String = o.getString("tone")
    val color: Int = Color.parseColor(o.getString("color"))
  }

  private class Snapshot(o: JSONObject) {
    val month: String = o.getString("month")
    val endsAt: Long = o.getLong("endsAt")
    val budget: Budget? = o.optJSONObject("budget")?.let { Budget(it) }
    val balance: Balance? = o.optJSONObject("balance")?.let { Balance(it) }
    val accounts: List<Account> =
      o.optJSONArray("accounts")?.let { a -> (0 until a.length()).map { Account(a.getJSONObject(it)) } }
        ?: emptyList()
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
    fun ids(provider: Class<*>) = manager.getAppWidgetIds(ComponentName(context, provider))

    val budgetIds = ids(BudgetWidgetProvider::class.java)
    if (budgetIds.isNotEmpty()) manager.updateAppWidget(budgetIds, budget(context, snapshot, now, night))

    // One RemoteViews PER widget: two Balance widgets of different heights
    // show different numbers of accounts.
    val balanceIds = ids(BalanceWidgetProvider::class.java)
    for (id in balanceIds) {
      manager.updateAppWidget(id, balance(context, snapshot, now, night, heightDp(manager, id)))
    }

    val quickIds = ids(QuickWidgetProvider::class.java)
    if (quickIds.isNotEmpty()) manager.updateAppWidget(quickIds, quick(context, snapshot, night))

    // Only the two widgets with figures go stale or count days.
    if (budgetIds.isNotEmpty() || balanceIds.isNotEmpty()) {
      scheduleRefresh(context, snapshot?.endsAt, now)
    } else {
      cancelRefresh(context)
    }
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

  /**
   * Why a widget with figures cannot show them, or null when it can. The same
   * answers on both, so they never disagree about the same moment.
   */
  private fun blocked(s: Snapshot?, now: Long): Pair<Int, String>? =
    when {
      s == null -> R.drawable.peace_widget_calendar to "Open Peace once to show this month here."
      // A month that has ended is not this month. Its figures would be read
      // as today's, so they are not shown at all until the app writes again.
      now >= s.endsAt -> R.drawable.peace_widget_calendar to "A new month has started. Open Peace to update."
      // The snapshot carries no figures at all while the app lock is on.
      s.balance == null -> R.drawable.peace_widget_lock to "Peace is locked. Open it to see this month."
      else -> null
    }

  private fun monthLabel(s: Snapshot?, now: Long): String =
    when {
      s == null -> "This month"
      now >= s.endsAt -> "New month"
      else -> s.month
    }

  // --------------------------------------------------------------- budget --

  private fun budget(context: Context, s: Snapshot?, now: Long, night: Boolean): RemoteViews {
    val rv = RemoteViews(context.packageName, R.layout.peace_widget_budget)
    val paint = Painter(rv, s?.theme, night)
    frame(context, rv, paint, s, now)

    val stop = blocked(s, now)
    if (s == null || stop != null) {
      val (icon, text) = stop ?: (R.drawable.peace_widget_calendar to "Open Peace once to show this month here.")
      notice(rv, paint, icon, text)
      return rv
    }
    val b = s.budget
    if (b == null) {
      // Says what is missing rather than quietly becoming the Balance widget,
      // and the whole widget opens the screen that fixes it.
      notice(rv, paint, R.drawable.peace_widget_budgets, "No budget for ${s.month}. Set one in Peace.")
      rv.setOnClickPendingIntent(R.id.widget_root, link(context, "peace://budgets", 4))
      return rv
    }
    figures(rv, paint, b.amount, "expense", b.beside, "${b.foot} · ${daysLeft(now, s.endsAt)}")
    rv.setViewVisibility(R.id.bar_holder, View.VISIBLE)
    paint.bar(b.fraction, b.over)
    return rv
  }

  // -------------------------------------------------------------- balance --

  private fun balance(context: Context, s: Snapshot?, now: Long, night: Boolean, heightDp: Int): RemoteViews {
    if (heightDp < COMPACT_BELOW_DP) return balanceCompact(context, s, now, night)
    val rv = RemoteViews(context.packageName, R.layout.peace_widget_balance)
    val paint = Painter(rv, s?.theme, night)
    frame(context, rv, paint, s, now)

    val stop = blocked(s, now)
    val b = s?.balance
    if (s == null || stop != null || b == null) {
      val (icon, text) = stop ?: (R.drawable.peace_widget_lock to "Peace is locked. Open it to see this month.")
      notice(rv, paint, icon, text)
      accounts(rv, paint, emptyList(), 0)
      return rv
    }

    figures(rv, paint, b.amount, b.tone, b.beside, b.foot)
    accounts(rv, paint, s.accounts, accountsThatFit(s.accounts.size, heightDp - BALANCE_TOP_DP))
    return rv
  }

  /**
   * One row: "OCTOBER · NOW" over the figure, the buttons beside it. A notice
   * has no room for a sentence here, so it is the short form of the same one.
   */
  private fun balanceCompact(context: Context, s: Snapshot?, now: Long, night: Boolean): RemoteViews {
    val rv = RemoteViews(context.packageName, R.layout.peace_widget_balance_compact)
    val paint = Painter(rv, s?.theme, night)
    clicks(context, rv)
    paint.tint(R.id.widget_bg) { it.surface }
    buttons(paint)
    paint.text(R.id.month) { it.muted }

    val b = s?.balance
    val short =
      when {
        s == null -> "Open Peace once"
        now >= s.endsAt -> "Open Peace to update"
        b == null -> "Peace is locked"
        else -> null
      }
    if (short != null || b == null) {
      rv.setTextViewText(R.id.month, monthLabel(s, now))
      rv.setTextViewText(R.id.amount, short ?: "Peace is locked")
      rv.setTextViewTextSize(R.id.amount, TypedValue.COMPLEX_UNIT_SP, 15f)
      paint.text(R.id.amount) { it.ink }
      return rv
    }
    rv.setTextViewText(R.id.month, "${s?.month ?: ""} · ${b.beside}")
    rv.setTextViewText(R.id.amount, b.amount)
    paint.text(R.id.amount) { tone(it, b.tone) }
    return rv
  }

  /**
   * How many accounts to list in `spaceDp`. All of them when they fit;
   * otherwise as many as fit ABOVE the "and N more" line, because a list that
   * silently stops looks complete.
   */
  private fun accountsThatFit(count: Int, spaceDp: Int): Int {
    if (spaceDp < ACCOUNT_ROW_DP) return 0
    if (count * ACCOUNT_ROW_DP <= spaceDp && count <= MAX_ACCOUNT_ROWS) return count
    return ((spaceDp - MORE_LINE_DP) / ACCOUNT_ROW_DP).coerceIn(0, MAX_ACCOUNT_ROWS)
  }

  /** The first `fits` accounts, then "and N more" for the rest. */
  private fun accounts(rv: RemoteViews, paint: Painter, list: List<Account>, fits: Int) {
    val show = fits > 0 && list.isNotEmpty()
    rv.setViewVisibility(R.id.accounts, if (show) View.VISIBLE else View.GONE)
    // The spacer takes the slack only when the accounts do not, so without
    // them the quick bar sits at the foot as it does on the Budget widget.
    rv.setViewVisibility(R.id.spacer, if (show) View.GONE else View.VISIBLE)
    if (!show) return

    for (i in 0 until MAX_ACCOUNT_ROWS) {
      val row = ACCOUNT_ROWS[i]
      if (i >= fits) {
        rv.setViewVisibility(row.root, View.GONE)
        continue
      }
      val a = list[i]
      rv.setViewVisibility(row.root, View.VISIBLE)
      // An account's colour is data, the same in every theme.
      rv.setInt(row.dot, "setColorFilter", a.color)
      rv.setTextViewText(row.name, a.name)
      paint.text(row.name) { it.ink }
      rv.setTextViewText(row.amount, a.amount)
      paint.text(row.amount) { tone(it, a.tone) }
    }
    val rest = list.size - fits
    if (rest > 0) {
      rv.setViewVisibility(R.id.acc_more, View.VISIBLE)
      rv.setTextViewText(R.id.acc_more, "and $rest more")
      paint.text(R.id.acc_more) { it.muted }
    } else {
      rv.setViewVisibility(R.id.acc_more, View.GONE)
    }
  }

  private class Row(val root: Int, val dot: Int, val name: Int, val amount: Int)

  private val ACCOUNT_ROWS =
    listOf(
      Row(R.id.acc_1, R.id.acc_1_dot, R.id.acc_1_name, R.id.acc_1_amount),
      Row(R.id.acc_2, R.id.acc_2_dot, R.id.acc_2_name, R.id.acc_2_amount),
      Row(R.id.acc_3, R.id.acc_3_dot, R.id.acc_3_name, R.id.acc_3_amount),
      Row(R.id.acc_4, R.id.acc_4_dot, R.id.acc_4_name, R.id.acc_4_amount),
      Row(R.id.acc_5, R.id.acc_5_dot, R.id.acc_5_name, R.id.acc_5_amount),
      Row(R.id.acc_6, R.id.acc_6_dot, R.id.acc_6_name, R.id.acc_6_amount),
    )

  /**
   * The widget's height in dp as the launcher currently draws it: the MAX
   * height in portrait and the MIN in landscape, which is how the options
   * bundle reports a resizable widget's two orientations.
   */
  private fun heightDp(manager: AppWidgetManager, id: Int): Int {
    val options = manager.getAppWidgetOptions(id)
    val portrait = Resources.getSystem().configuration.orientation != Configuration.ORIENTATION_LANDSCAPE
    return options.getInt(
      if (portrait) AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
    )
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

  /** Background, header and the quick bar: everything both figure widgets share. */
  private fun frame(context: Context, rv: RemoteViews, paint: Painter, s: Snapshot?, now: Long) {
    clicks(context, rv)
    paint.tint(R.id.widget_bg) { it.surface }
    rv.setTextViewText(R.id.month, monthLabel(s, now))
    paint.text(R.id.month) { it.muted }
    paint.tint(R.id.wordmark) { it.accent }
    buttons(paint)
  }

  private fun figures(rv: RemoteViews, paint: Painter, amount: String, tone: String, beside: String, foot: String) {
    rv.setViewVisibility(R.id.figures, View.VISIBLE)
    rv.setViewVisibility(R.id.notice, View.GONE)
    rv.setTextViewText(R.id.amount, amount)
    paint.text(R.id.amount) { tone(it, tone) }
    rv.setTextViewText(R.id.beside, beside)
    paint.text(R.id.beside) { it.muted }
    rv.setTextViewText(R.id.foot, foot)
    paint.text(R.id.foot) { it.muted }
  }

  private fun notice(rv: RemoteViews, paint: Painter, icon: Int, text: String) {
    rv.setViewVisibility(R.id.figures, View.GONE)
    rv.setViewVisibility(R.id.notice, View.VISIBLE)
    rv.setImageViewResource(R.id.notice_icon, icon)
    paint.tint(R.id.notice_icon) { it.muted }
    rv.setTextViewText(R.id.notice_text, text)
    paint.text(R.id.notice_text) { it.ink }
  }

  private fun tone(p: Palette, tone: String): Int =
    when (tone) {
      "income" -> p.income
      "expense" -> p.expense
      else -> p.ink
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

  private fun buttons(paint: Painter) {
    paint.tint(R.id.btn_expense_bg) { it.accent }
    paint.tint(R.id.btn_expense_icon) { it.accentInk }
    paint.text(R.id.btn_expense_label) { it.accentInk }
    paint.tint(R.id.btn_receipt_bg) { it.raised }
    paint.tint(R.id.btn_receipt_icon) { it.ink }
    paint.tint(R.id.btn_voice_bg) { it.raised }
    paint.tint(R.id.btn_voice_icon) { it.ink }
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
    rv.setOnClickPendingIntent(R.id.btn_voice, link(context, "peace://record?voice=1", 5))
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

  private fun cancelRefresh(context: Context) {
    context.getSystemService(AlarmManager::class.java)?.cancel(refreshIntent(context))
  }

  private fun refreshIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      0,
      Intent(context, WidgetRefreshReceiver::class.java),
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
