// T019 of specs/004-sessions (the notes under T019): starts and stops RoomKeepAliveService.
package com.ijazah.roomkeepalive

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RoomKeepAliveModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RoomKeepAlive")

    Function("start") { title: String, text: String ->
      val intent = Intent(context, RoomKeepAliveService::class.java)
        .putExtra(RoomKeepAliveService.EXTRA_TITLE, title)
        .putExtra(RoomKeepAliveService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
    }

    Function("stop") {
      context.stopService(Intent(context, RoomKeepAliveService::class.java))
      Unit
    }
  }
}
