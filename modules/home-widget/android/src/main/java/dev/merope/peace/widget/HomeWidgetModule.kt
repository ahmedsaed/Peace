package dev.merope.peace.widget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app's side of the home-screen widgets: hand over a snapshot, redraw.
 *
 * The snapshot is JSON built by `src/lib/widget.ts` — every figure already
 * formatted and masked, so nothing here formats money or decides what is safe
 * to show. It is stored before anything is drawn, because a widget added
 * tomorrow, or redrawn after a reboot, reads the store and not this call.
 */
class HomeWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HomeWidget")

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function false
      WidgetStore.write(context, json)
      WidgetRenderer.updateAll(context)
      true
    }
  }
}
