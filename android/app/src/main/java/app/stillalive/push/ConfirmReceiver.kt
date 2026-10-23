package app.stillalive.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.stillalive.data.AppRepository
import java.util.concurrent.TimeUnit

/** Handles the "I'm OK" button on the notification without opening the app. */
class ConfirmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Notifications.cancelReminder(context)
        ConfirmWorker.enqueue(context)
    }
}

/** Sends the confirmation, retrying until the phone has connectivity. */
class ConfirmWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (AppRepository.currentUser == null) return Result.failure()
        return try {
            AppRepository.confirm(via = "notification")
            Notifications.showConfirmed(applicationContext)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "confirm"

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<ConfirmWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
