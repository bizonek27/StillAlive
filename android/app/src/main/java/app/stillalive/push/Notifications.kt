package app.stillalive.push

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.stillalive.MainActivity
import app.stillalive.R

object Notifications {
    private const val REMINDER_ID = 1
    private const val CONFIRMED_TIMEOUT_MS = 5_000L

    fun createChannel(context: Context) {
        val channel = NotificationChannel(
            context.getString(R.string.channel_checkin_id),
            context.getString(R.string.channel_checkin_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.channel_checkin_description)
            enableVibration(true)
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun showReminder(context: Context) {
        val openApp = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val confirm = PendingIntent.getBroadcast(
            context, 0,
            Intent(context, ConfirmReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        notify(
            context,
            builder(context)
                .setContentTitle(context.getString(R.string.notification_title))
                .setContentText(context.getString(R.string.notification_text))
                .setStyle(NotificationCompat.BigTextStyle().bigText(context.getString(R.string.notification_text)))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(openApp)
                .addAction(R.drawable.ic_heart, context.getString(R.string.notification_action_confirm), confirm)
                .setAutoCancel(true),
        )
    }

    /** Replaces the reminder with a short-lived "thank you". */
    fun showConfirmed(context: Context) {
        notify(
            context,
            builder(context)
                .setContentTitle(context.getString(R.string.notification_confirmed))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setTimeoutAfter(CONFIRMED_TIMEOUT_MS)
                .setAutoCancel(true),
        )
    }

    fun cancelReminder(context: Context) {
        NotificationManagerCompat.from(context).cancel(REMINDER_ID)
    }

    private fun builder(context: Context) =
        NotificationCompat.Builder(context, context.getString(R.string.channel_checkin_id))
            .setSmallIcon(R.drawable.ic_heart)
            .setColor(context.getColor(R.color.brand_green))

    @SuppressLint("MissingPermission") // Guarded by areNotificationsEnabled().
    private fun notify(context: Context, builder: NotificationCompat.Builder) {
        val manager = NotificationManagerCompat.from(context)
        if (manager.areNotificationsEnabled()) manager.notify(REMINDER_ID, builder.build())
    }
}
