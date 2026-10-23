package app.stillalive.ui

import android.app.Activity
import android.app.Application
import android.util.Log
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.stillalive.R
import app.stillalive.data.AppRepository
import app.stillalive.data.ProfileInput
import app.stillalive.data.UserProfile
import app.stillalive.data.normalizePhone
import app.stillalive.push.Notifications
import com.google.firebase.FirebaseException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthProvider
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed interface ProfileState {
    data object Loading : ProfileState
    data object Missing : ProfileState
    data class Loaded(val profile: UserProfile) : ProfileState
}

data class LoginUi(
    val phone: String = "+48",
    val code: String = "",
    val codeSent: Boolean = false,
    val busy: Boolean = false,
    @StringRes val error: Int? = null,
    /** Raw Firebase message, shown under [error] to make setup problems diagnosable. */
    val errorDetail: String? = null,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = AppRepository

    private val _messages = MutableSharedFlow<Int>(extraBufferCapacity = 4)
    val messages: SharedFlow<Int> = _messages

    val user: StateFlow<FirebaseUser?> = repo.authState()
        .stateIn(viewModelScope, SharingStarted.Eagerly, repo.currentUser)

    @OptIn(ExperimentalCoroutinesApi::class)
    val profile: StateFlow<ProfileState> = user
        .flatMapLatest { user ->
            if (user == null) {
                flowOf(ProfileState.Missing)
            } else {
                repo.profile(user.uid)
                    .map { it?.let(ProfileState::Loaded) ?: ProfileState.Missing }
                    .onStart { emit(ProfileState.Loading) }
                    .catch {
                        Log.w(TAG, "Profile listener failed", it)
                        _messages.emit(R.string.error_generic)
                    }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProfileState.Loading)

    var login by mutableStateOf(LoginUi())
        private set

    /** True while a confirmation or save is in flight. */
    var busy by mutableStateOf(false)
        private set

    private var verificationId: String? = null
    private var verificationTimeout: Job? = null

    init {
        // Keep the backend's FCM token current for whoever is signed in.
        viewModelScope.launch {
            user.filterNotNull().distinctUntilChangedBy { it.uid }.collect {
                runCatching { repo.registerFcmToken() }.onFailure { Log.w(TAG, "FCM token registration failed", it) }
            }
        }
    }

    // ---------- Login ----------

    fun onPhoneChange(value: String) {
        login = login.copy(phone = value, error = null, errorDetail = null)
    }

    fun onCodeChange(value: String) {
        login = login.copy(code = value.filter(Char::isDigit).take(6), error = null, errorDetail = null)
    }

    fun changeNumber() {
        verificationId = null
        login = login.copy(codeSent = false, code = "", error = null)
    }

    fun sendCode(activity: Activity) {
        val phone = normalizePhone(login.phone)
        if (phone == null) {
            login = login.copy(error = R.string.contact_invalid_phone)
            return
        }
        login = login.copy(busy = true, error = null, errorDetail = null)
        // Firebase sometimes never calls back (e.g. no Google Play services); don't spin forever.
        verificationTimeout?.cancel()
        verificationTimeout = viewModelScope.launch {
            delay(VERIFICATION_TIMEOUT_MS)
            if (login.busy && !login.codeSent) login = login.copy(busy = false, error = R.string.login_timeout)
        }
        repo.verifyPhoneNumber(activity, phone, object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
            override fun onVerificationCompleted(credential: PhoneAuthCredential) {
                verificationTimeout?.cancel()
                signIn(credential)
            }

            override fun onVerificationFailed(e: FirebaseException) {
                Log.w(TAG, "Phone verification failed", e)
                verificationTimeout?.cancel()
                login = login.copy(busy = false, error = R.string.login_error, errorDetail = e.message)
            }

            override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
                verificationTimeout?.cancel()
                verificationId = id
                login = login.copy(busy = false, codeSent = true)
            }
        })
    }

    fun verifyCode() {
        val id = verificationId ?: return
        signIn(PhoneAuthProvider.getCredential(id, login.code))
    }

    private fun signIn(credential: PhoneAuthCredential) {
        login = login.copy(busy = true, error = null)
        viewModelScope.launch {
            login = try {
                repo.signIn(credential)
                LoginUi()
            } catch (e: Exception) {
                Log.w(TAG, "Sign-in failed", e)
                login.copy(busy = false, error = R.string.login_error, errorDetail = e.message)
            }
        }
    }

    // ---------- Signed in ----------

    fun confirm() = runBusy(R.string.confirmed_toast) {
        repo.confirm(via = "app")
        Notifications.cancelReminder(getApplication())
    }

    fun saveProfile(input: ProfileInput, onSaved: () -> Unit = {}) = runBusy(R.string.settings_saved) {
        repo.saveProfile(input)
        onSaved()
    }

    fun deleteAccount() = runBusy(null) { repo.deleteAccount() }

    fun signOut() = repo.signOut()

    private fun runBusy(@StringRes successMessage: Int?, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                block()
                successMessage?.let { _messages.emit(it) }
            } catch (e: Exception) {
                Log.w(TAG, "Request failed", e)
                val limited = (e as? FirebaseFunctionsException)?.code == FirebaseFunctionsException.Code.RESOURCE_EXHAUSTED
                _messages.emit(if (limited) R.string.error_contact_limit else R.string.error_generic)
            } finally {
                busy = false
            }
        }
    }

    private companion object {
        const val TAG = "StillAlive"
        const val VERIFICATION_TIMEOUT_MS = 90_000L
    }
}
