package com.ahmed.peace.notifications

import android.app.Notification
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Catches SMS notifications so a bank message can become a record.
 *
 * WHY A SERVICE AND NOT `READ_SMS`. Reading the inbox needs a restricted
 * permission that closes the Play Store door permanently and asks for far more
 * than this feature needs. A notification listener sees the message the
 * messaging app already chose to show, which is the same information a person
 * reads off their lock screen.
 *
 * IT WRITES TO DISK RATHER THAN CALLING JAVASCRIPT. A bank message arrives at
 * two in the afternoon while the app is closed, and there is no React context
 * to hand it to — an event emitter would drop it silently, which is the one
 * outcome that makes the feature useless. Captures go to a small store the app
 * drains when it is next opened, for the same reason the Drive backup catches
 * up on launch: the app being opened IS the mechanism.
 *
 * NOTHING IS PARSED HERE. This decides only "is this an SMS", and even that by
 * asking Android which app owns SMS rather than by carrying a list of package
 * names that would rot. Which SENDERS matter is the user's business and lives
 * in their settings, where it can be edited; a filter compiled into Kotlin
 * could only be changed by shipping an APK.
 */
class NotificationCaptureService : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val store = CaptureStore(applicationContext)

    // Nothing is captured at all until the user has switched this on. The
    // permission being granted is Android's business; whether Peace should be
    // watching is the user's, and they are not the same question — a listener
    // that keeps reading after the feature is switched off is a betrayal.
    if (!store.isEnabled()) return

    if (!isFromMessagingApp(sbn.packageName)) return

    val extras = sbn.notification.extras

    /**
     * BIG TEXT FIRST. `EXTRA_TEXT` is the collapsed one-line form and is
     * truncated with an ellipsis; `EXTRA_BIG_TEXT` carries the whole message
     * whenever the poster used `BigTextStyle`, which messaging apps do. Reading
     * only `EXTRA_TEXT` is the classic way this feature silently loses the half
     * of the message with the amount in it.
     */
    val body = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
      ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
      ?: return

    // The sender: a short code like "CIB" or a phone number, whatever the
    // messaging app put in the title.
    val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()

    if (body.isBlank() || sender.isBlank()) return

    store.add(
      sender = sender,
      body = body,
      packageName = sbn.packageName,
      postedAt = sbn.postTime,
    )
  }

  /**
   * Is this the app that owns SMS on this phone?
   *
   * Asked of Android rather than answered from a list. Messaging apps differ by
   * manufacturer and by user choice, and a hard-coded set of package names
   * would quietly capture nothing on the first phone that ships something else.
   */
  private fun isFromMessagingApp(packageName: String): Boolean {
    val default = Telephony.Sms.getDefaultSmsPackage(applicationContext)
    return default != null && default == packageName
  }
}
