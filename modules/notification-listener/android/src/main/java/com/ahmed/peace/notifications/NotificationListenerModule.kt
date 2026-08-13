package com.ahmed.peace.notifications

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JavaScript side of notification capture.
 *
 * Four things and no more: is the listener allowed, take me to the screen that
 * allows it, turn capture on or off, and hand over what has been captured.
 * Everything about WHICH messages matter and what they mean lives in
 * JavaScript, where it can be tested without a phone.
 */
class NotificationListenerModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val store: CaptureStore
    get() = CaptureStore(context)

  /**
   * Held as a FIELD, not a lambda passed inline.
   *
   * `SharedPreferences` keeps only a weak reference to its listeners, so one
   * created at registration time is collected at the next GC and the events
   * simply stop — silently, and long after any testing would notice.
   */
  private var captureListener: SharedPreferences.OnSharedPreferenceChangeListener? = null

  override fun definition() = ModuleDefinition {
    Name("NotificationListener")

    /**
     * Fired when the service captures something while the app is running.
     *
     * WITHOUT THIS THE APP ONLY LOOKS ON LAUNCH AND ON FOREGROUND. A message
     * arriving while someone is staring at the records list produced nothing at
     * all until they switched month or reopened the app — which reads exactly
     * like the feature being broken.
     *
     * The signal is the capture store itself. The service and this module run in
     * the same process, so a `SharedPreferences` change listener sees the write
     * directly: no static holder, no reference from the service back into the
     * React context, and nothing to keep in step.
     */
    Events("onCapture")

    OnStartObserving {
      val prefs = context.getSharedPreferences(CaptureStore.PREFS, Context.MODE_PRIVATE)
      val listener =
        SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
          // Only the entries. The enabled flag changes when the user flips the
          // switch, and waking the reader for that would be pointless work.
          if (key == CaptureStore.KEY_ENTRIES) sendEvent("onCapture", mapOf<String, Any>())
        }
      captureListener = listener
      prefs.registerOnSharedPreferenceChangeListener(listener)
    }

    OnStopObserving {
      captureListener?.let {
        context
          .getSharedPreferences(CaptureStore.PREFS, Context.MODE_PRIVATE)
          .unregisterOnSharedPreferenceChangeListener(it)
      }
      captureListener = null
    }

    /**
     * Has the user granted notification access?
     *
     * There is no runtime permission dialog for this — it is granted on a
     * system settings screen — so the only way to know is to ask which packages
     * are currently enabled and look for ours.
     */
    Function("isPermitted") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    /**
     * Open the screen that grants it.
     *
     * `FLAG_ACTIVITY_NEW_TASK` because this is launched from a module rather
     * than from an Activity context; without it Android refuses to start it.
     */
    Function("openSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /**
     * Whether Peace should be capturing at all.
     *
     * Separate from the Android permission on purpose. Revoking notification
     * access is buried several screens deep in system settings; switching the
     * feature off has to be one tap inside the app, and it has to actually stop
     * capture rather than merely stop reading.
     */
    Function("isEnabled") { store.isEnabled() }

    Function("setEnabled") { enabled: Boolean -> store.setEnabled(enabled) }

    /** Waiting to be read, for a screen that wants to say so. */
    Function("pendingCount") { store.pendingCount() }

    /**
     * Take everything captured and clear it.
     *
     * Returns raw JSON rather than a typed array: the shape is decided and
     * validated in JavaScript, in one place, and a native-side type would be a
     * second definition of it to keep in step.
     */
    Function("drain") { store.drain() }
  }
}
