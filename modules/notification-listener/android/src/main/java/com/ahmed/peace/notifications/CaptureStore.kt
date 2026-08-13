package com.ahmed.peace.notifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Where a captured message waits until the app is next opened.
 *
 * SharedPreferences rather than the app's SQLite database, deliberately. The
 * service runs with no React context and no open Drizzle connection, and
 * teaching Kotlin the schema would tie a native file to a migration history it
 * cannot see — the first `db:generate` would break capture with nothing to say
 * why. This store knows one shape, owns it completely, and hands it over.
 *
 * BOUNDED ON PURPOSE. If the app is never opened this must not grow without
 * limit, so the newest `MAX_ENTRIES` are kept and the oldest fall off. Losing
 * the oldest capture in a backlog of two hundred is a far better failure than
 * a preferences file that grows until it cannot be read.
 */
class CaptureStore(context: Context) {

  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isEnabled(): Boolean = prefs.getBoolean(KEY_ENABLED, false)

  /** Set from JavaScript, so switching the feature off stops capture at once. */
  fun setEnabled(enabled: Boolean) {
    prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
  }

  @Synchronized
  fun add(sender: String, body: String, packageName: String, postedAt: Long) {
    val existing = read()

    /**
     * The same notification is posted repeatedly.
     *
     * Messaging apps update a notification in place — a second message from the
     * same sender re-posts the whole conversation — so without this the same
     * bank message arrives three or four times and would be offered as three or
     * four records. Sender plus body is the identity that matters; the posted
     * time is not, because an update carries a new one for the same text.
     */
    for (i in 0 until existing.length()) {
      val entry = existing.optJSONObject(i) ?: continue
      if (entry.optString("sender") == sender && entry.optString("body") == body) return
    }

    existing.put(
      JSONObject().apply {
        put("sender", sender)
        put("body", body)
        put("packageName", packageName)
        put("postedAt", postedAt)
      }
    )

    // Keep the newest, drop the oldest.
    val trimmed = JSONArray()
    val start = maxOf(0, existing.length() - MAX_ENTRIES)
    for (i in start until existing.length()) trimmed.put(existing.get(i))

    prefs.edit().putString(KEY_ENTRIES, trimmed.toString()).apply()
  }

  /**
   * Hand everything over and forget it.
   *
   * Read and clear in ONE synchronized step. Two calls — take, then clear —
   * would drop anything that arrived in between, which is exactly when a
   * message is most likely to arrive: the app has just been opened and the
   * phone is awake.
   */
  @Synchronized
  fun drain(): String {
    val entries = prefs.getString(KEY_ENTRIES, EMPTY) ?: EMPTY
    prefs.edit().remove(KEY_ENTRIES).apply()
    return entries
  }

  /** How many are waiting, without consuming them. */
  @Synchronized
  fun pendingCount(): Int = read().length()

  private fun read(): JSONArray =
    try {
      JSONArray(prefs.getString(KEY_ENTRIES, EMPTY) ?: EMPTY)
    } catch (_: Exception) {
      // A corrupt store must never stop the app from starting. Losing captures
      // that could not be read is the smallest possible loss here.
      JSONArray()
    }

  companion object {
    const val PREFS = "peace.notifications"
    const val KEY_ENTRIES = "entries"
    const val KEY_ENABLED = "enabled"
    const val EMPTY = "[]"
    const val MAX_ENTRIES = 200
  }
}
