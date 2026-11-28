// T019 of specs/004-sessions (the notes under T019): starts and stops RoomKeepAliveService.
//
// T068 (the open point under it, `:129`, settled by R3's Q-7 (a); SRS DEC-109): the service is
// started as an ordinary service, from the share's tap with the app in front, and moves itself to
// the foreground; `startForegroundService` would promise Android a `startForeground` within
// seconds, and a refused one would then end the app. When Android refuses the start itself (the
// app not in front, Android 8 and later), the call throws, so the JavaScript start rejects and the
// share is given up as a failed start. The stop is a stop intent the service acts on once
// `startForeground` has run, never `stopService`, which could stop it before.
package com.ijazah.roomkeepalive

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Android refused to start the service (T068: the app was not in front). */
class KeepAliveNotStartedException(cause: Throwable) :
  CodedException("The room keep-alive could not start with the app behind.", cause)

class RoomKeepAliveModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RoomKeepAlive")

    Function("start") { title: String, text: String ->
      val intent = Intent(context, RoomKeepAliveService::class.java)
        .setAction(RoomKeepAliveService.ACTION_START)
        .putExtra(RoomKeepAliveService.EXTRA_TITLE, title)
        .putExtra(RoomKeepAliveService.EXTRA_TEXT, text)
      try {
        context.startService(intent)
      } catch (refused: IllegalStateException) {
        throw KeepAliveNotStartedException(refused)
      }
      Unit
    }

    Function("stop") {
      val intent = Intent(context, RoomKeepAliveService::class.java)
        .setAction(RoomKeepAliveService.ACTION_STOP)
      try {
        context.startService(intent)
      } catch (_: IllegalStateException) {
        // Android refuses it only with the app behind and no foreground service of the app
        // running, so no keep-alive is in the foreground and there is nothing to stop.
      }
      Unit
    }
  }
}
