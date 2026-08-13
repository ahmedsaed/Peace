package com.ahmed.peace.notifications

import android.content.Context
import android.content.Intent
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

  override fun definition() = ModuleDefinition {
    Name("NotificationListener")

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
