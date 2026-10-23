package app.stillalive.push

import android.util.Log
import app.stillalive.data.AppRepository
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class StillAliveMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(message: RemoteMessage) {
        // The backend sends data-only messages so we can build a notification with an action button.
        if (message.data["type"] == "checkin_reminder") {
            Notifications.showReminder(this)
        }
    }

    override fun onNewToken(token: String) {
        if (AppRepository.currentUser == null) return
        scope.launch {
            runCatching { AppRepository.registerFcmToken(token) }
                .onFailure { Log.w(TAG, "Could not register FCM token", it) }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "StillAliveFCM"
    }
}
