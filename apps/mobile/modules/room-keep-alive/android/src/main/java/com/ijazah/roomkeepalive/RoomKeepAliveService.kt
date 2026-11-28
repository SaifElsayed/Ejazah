// T019 of specs/004-sessions (the owner's conditions of 2026-11-09, the notes under T019): while the
// screen is shared, a foreground service of type microphone, its notification up for the whole share,
// so the participant's microphone keeps working behind another app, and a headless JS task, because
// React Native keeps its JS timers running only while one is active. Started by the app while it is
// visible; Android refuses this type from the background.
//
// T068 (PR #130's review, round 1, Minor 5; the open point `:129`, settled by R3's Q-7 (a)): no path
// stops the service before `startForeground` has run. The module starts it as an ordinary service
// (no promise to Android to reach the foreground) and stops it with `ACTION_STOP`: a stop that
// arrives once `startForeground` has run stops the service at once; one that arrives while a start
// has not reached it yet is held and acted on right after it; one with no start at all stops the
// service at once. A refused `startForeground` (the microphone permission, or any other reason) is
// caught and the service stops itself, which breaks no promise, and the app gives the share up.
package com.ijazah.roomkeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class RoomKeepAliveService : HeadlessJsTaskService() {
  /** A start was read and has not yet reached `startForeground` (T068). */
  private var starting = false

  /** `startForeground` has run for this service (T068). */
  private var inForeground = false

  /** A stop that came while a start had not reached `startForeground` (T068). */
  private var stopHeld = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent.action == ACTION_STOP) {
      onStop()
      return START_NOT_STICKY
    }
    starting = true
    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification(intent),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
      )
    } catch (_: RuntimeException) {
      // Android refused it: no task runs, and the app gives the share up. Started with
      // `startService`, the service owes Android no `startForeground`, so stopping here is safe.
      starting = false
      stopSelf()
      return START_NOT_STICKY
    }
    starting = false
    inForeground = true
    if (stopHeld) {
      stopSelf()
      return START_NOT_STICKY
    }
    super.onStartCommand(intent, flags, startId)
    return START_NOT_STICKY
  }

  private fun onStop() {
    if (starting && !inForeground) {
      stopHeld = true
      return
    }
    stopSelf()
  }

  // No timeout, allowed in the foreground: it starts while the app is visible and lasts the share.
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? =
    HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0L, true)

  private fun notification(intent: Intent): Notification {
    val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_LOW),
      )
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(intent.getStringExtra(EXTRA_TEXT).orEmpty())
      .setSmallIcon(applicationInfo.icon)
      .setContentIntent(open)
      .setOngoing(true)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val ACTION_START = "com.ijazah.roomkeepalive.START"
    const val ACTION_STOP = "com.ijazah.roomkeepalive.STOP"
    private const val TASK_KEY = "RoomKeepAlive"
    private const val CHANNEL_ID = "room_keep_alive"
    private const val NOTIFICATION_ID = 7419
  }
}
