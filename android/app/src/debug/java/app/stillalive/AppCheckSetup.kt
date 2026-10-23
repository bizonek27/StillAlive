package app.stillalive

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * Debug builds are not installed from Google Play, so Play Integrity cannot vouch for them.
 * On first launch the debug provider logs a secret ("Enter this debug secret into the allow list")
 * that must be added in Firebase Console → App Check → Apps → Manage debug tokens.
 */
object AppCheckSetup {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
    }
}
