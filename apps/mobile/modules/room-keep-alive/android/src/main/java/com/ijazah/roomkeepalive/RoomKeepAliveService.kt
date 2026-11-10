// T019 of specs/004-sessions (the owner's conditions of 2026-11-09, the notes under T019): while the
// screen is shared, a foreground service of type microphone, its notification up for the whole share,
// so the participant's microphone keeps working behind another app, and a headless JS task, because
// React Native keeps its JS timers running only while one is active. Started by the app while it is
// visible; Android refuses this type from the background.
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
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification(intent),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
      )
    } catch (_: RuntimeException) {
      // Android refused it: no task runs, and the app gives the share up.
      stopSelf()
      return START_NOT_STICKY
    }
    super.onStartCommand(intent, flags, startId)
    return START_NOT_STICKY
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
    private const val TASK_KEY = "RoomKeepAlive"
    private const val CHANNEL_ID = "room_keep_alive"
    private const val NOTIFICATION_ID = 7419
  }
}
