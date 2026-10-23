package app.stillalive

import android.app.Application
import app.stillalive.push.Notifications

class StillAliveApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppCheckSetup.install()
        Notifications.createChannel(this)
    }
}
