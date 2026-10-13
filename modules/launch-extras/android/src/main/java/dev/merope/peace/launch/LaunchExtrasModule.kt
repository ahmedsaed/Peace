package dev.merope.peace.launch

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The string extras on the intent that started the app, limited to `peace.*`.
 *
 * This is how a test harness tells a FRESH install what it would otherwise
 * have to answer on screen: Maestro's `launchApp: arguments` arrive as intent
 * extras, and nothing in JavaScript can see those. JS honours them only on a
 * ledger that has never been opened (see `src/lib/first-run.ts`), so an extra
 * on a later launch — from a test or from another app — changes nothing.
 */
class LaunchExtrasModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LaunchExtras")

    Function("read") {
      val extras = appContext.currentActivity?.intent?.extras
        ?: return@Function emptyMap<String, String>()
      extras.keySet()
        .filter { it.startsWith("peace.") }
        .mapNotNull { key ->
          @Suppress("DEPRECATION")
          (extras.get(key) as? String)?.let { key to it }
        }
        .toMap()
    }
  }
}
