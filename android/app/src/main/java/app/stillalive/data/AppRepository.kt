package app.stillalive.data

import android.app.Activity
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthOptions
import com.google.firebase.auth.PhoneAuthProvider
import com.google.firebase.auth.auth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.functions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/** Single access point to Firebase. All writes go through Cloud Functions. */
object AppRepository {
    private const val REGION = "europe-central2"
    /** Must match DATABASE_ID in functions/src/telephony.ts. */
    private const val DATABASE_ID = "stillalive"

    private val auth get() = Firebase.auth
    private val firestore get() = Firebase.firestore(DATABASE_ID)
    private val functions get() = Firebase.functions(REGION)

    val currentUser: FirebaseUser? get() = auth.currentUser

    fun authState(): Flow<FirebaseUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    fun verifyPhoneNumber(
        activity: Activity,
        phone: String,
        callbacks: PhoneAuthProvider.OnVerificationStateChangedCallbacks,
    ) {
        val options = PhoneAuthOptions.newBuilder(auth)
            .setPhoneNumber(phone)
            .setTimeout(60L, TimeUnit.SECONDS)
            .setActivity(activity)
            .setCallbacks(callbacks)
            .build()
        PhoneAuthProvider.verifyPhoneNumber(options)
    }

    suspend fun signIn(credential: PhoneAuthCredential) {
        auth.signInWithCredential(credential).await()
    }

    /** Emits null while the profile has not been created yet. */
    fun profile(uid: String): Flow<UserProfile?> = callbackFlow {
        val registration = firestore.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                close(error)
            } else {
                trySend(snapshot?.toProfile())
            }
        }
        awaitClose { registration.remove() }
    }

    suspend fun confirm(via: String) {
        call("confirm", mapOf("via" to via))
    }

    suspend fun saveProfile(input: ProfileInput) {
        call(
            "saveProfile",
            mapOf(
                "displayName" to input.displayName,
                "address" to with(input.address) {
                    mapOf(
                        "street" to street, "building" to building, "apartment" to apartment,
                        "postalCode" to postalCode, "city" to city, "notes" to notes,
                    )
                },
                "language" to if (Locale.getDefault().language == "pl") "pl" else "en",
                "checkInHour" to input.checkInHour,
                "checkInMinute" to input.checkInMinute,
                "reminderIntervalMinutes" to input.reminderIntervalMinutes,
                "timezone" to TimeZone.getDefault().id,
                "quietStartHour" to input.quietStartHour,
                "quietEndHour" to input.quietEndHour,
                "escalateAfterMinutes" to input.escalateAfterMinutes,
                "policeAfterHours" to input.policeAfterHours,
                "contacts" to input.contacts.map {
                    mapOf("name" to it.name, "phone" to it.phone, "kind" to it.kind.wire)
                },
            ),
        )
    }

    suspend fun registerFcmToken(token: String? = null) {
        val value = token ?: FirebaseMessaging.getInstance().token.await()
        call("registerFcmToken", mapOf("token" to value))
    }

    suspend fun deleteAccount() {
        call("deleteAccount")
        auth.signOut()
    }

    fun signOut() = auth.signOut()

    private suspend fun call(name: String, data: Any? = null): Any? =
        functions.getHttpsCallable(name).call(data).await().getData()
}

private fun DocumentSnapshot.toProfile(): UserProfile? {
    // registerFcmToken may create the document before the profile is saved.
    if (!exists() || getString("displayName") == null) return null

    @Suppress("UNCHECKED_CAST")
    val contacts = (get("contacts") as? List<Map<String, Any?>>).orEmpty().map {
        Contact(
            name = it["name"] as? String ?: "",
            phone = it["phone"] as? String ?: "",
            kind = ContactKind.fromWire(it["kind"] as? String),
        )
    }
    return UserProfile(
        input = ProfileInput(
            displayName = getString("displayName").orEmpty(),
            address = toAddress(get("address")),
            checkInHour = getLong("checkInHour")?.toInt() ?: 10,
            checkInMinute = getLong("checkInMinute")?.toInt() ?: 0,
            reminderIntervalMinutes = getLong("reminderIntervalMinutes")?.toInt() ?: DEFAULT_REMINDER_INTERVAL_MINUTES,
            quietStartHour = getLong("quietStartHour")?.toInt() ?: 22,
            quietEndHour = getLong("quietEndHour")?.toInt() ?: 8,
            escalateAfterMinutes = getLong("escalateAfterMinutes")?.toInt()
                ?: getLong("escalateAfterHours")?.toInt()?.times(60) // saved before minutes were supported
                ?: DEFAULT_ESCALATE_AFTER_MINUTES,
            policeAfterHours = getLong("policeAfterHours")?.toInt() ?: DEFAULT_POLICE_AFTER_HOURS,
            contacts = contacts,
        ),
        phone = getString("phone").orEmpty(),
        state = CheckState.fromWire(getString("state")),
        lastConfirmedAt = getTimestamp("lastConfirmedAt")?.toDate(),
        nextDueAt = getTimestamp("nextDueAt")?.toDate(),
    )
}

private fun toAddress(value: Any?): Address = when (value) {
    is Map<*, *> -> Address(
        street = value["street"] as? String ?: "",
        building = value["building"] as? String ?: "",
        apartment = value["apartment"] as? String ?: "",
        postalCode = value["postalCode"] as? String ?: "",
        city = value["city"] as? String ?: "",
        notes = value["notes"] as? String ?: "",
    )
    // Profiles saved before the address was split into fields.
    is String -> Address(street = value)
    else -> Address()
}
