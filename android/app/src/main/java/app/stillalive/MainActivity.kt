package app.stillalive

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.stillalive.ui.HomeScreen
import app.stillalive.ui.LoginScreen
import app.stillalive.ui.MainViewModel
import app.stillalive.ui.ProfileState
import app.stillalive.ui.SettingsScreen
import app.stillalive.ui.StillAliveTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            StillAliveTheme {
                StillAliveRoot()
            }
        }
    }
}

@Composable
private fun StillAliveRoot(vm: MainViewModel = viewModel()) {
    val user by vm.user.collectAsStateWithLifecycle()
    val profile by vm.profile.collectAsStateWithLifecycle()
    var showSettings by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        vm.messages.collect { snackbar.showSnackbar(context.getString(it)) }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            val current = profile
            when {
                user == null -> LoginScreen(
                    state = vm.login,
                    onPhoneChange = vm::onPhoneChange,
                    onCodeChange = vm::onCodeChange,
                    onSendCode = vm::sendCode,
                    onVerify = vm::verifyCode,
                    onChangeNumber = vm::changeNumber,
                )

                current is ProfileState.Loading ->
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))

                current is ProfileState.Missing -> SettingsScreen(
                    initial = null,
                    onboarding = true,
                    busy = vm.busy,
                    onSave = { vm.saveProfile(it) },
                    onBack = {},
                    onSignOut = vm::signOut,
                    onDeleteAccount = vm::deleteAccount,
                )

                current is ProfileState.Loaded && showSettings -> SettingsScreen(
                    initial = current.profile.input,
                    onboarding = false,
                    busy = vm.busy,
                    onSave = { vm.saveProfile(it) { showSettings = false } },
                    onBack = { showSettings = false },
                    onSignOut = {
                        showSettings = false
                        vm.signOut()
                    },
                    onDeleteAccount = {
                        showSettings = false
                        vm.deleteAccount()
                    },
                )

                current is ProfileState.Loaded -> HomeScreen(
                    profile = current.profile,
                    busy = vm.busy,
                    onConfirm = vm::confirm,
                    onOpenSettings = { showSettings = true },
                )
            }
        }
    }
}
