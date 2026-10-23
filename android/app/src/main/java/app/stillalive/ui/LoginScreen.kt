package app.stillalive.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.stillalive.R

@Composable
fun LoginScreen(
    state: LoginUi,
    onPhoneChange: (String) -> Unit,
    onCodeChange: (String) -> Unit,
    onSendCode: (Activity) -> Unit,
    onVerify: () -> Unit,
    onChangeNumber: () -> Unit,
) {
    val activity = LocalContext.current as Activity
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_heart),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(top = 32.dp).size(96.dp),
        )
        Text(stringResource(R.string.login_title), style = MaterialTheme.typography.headlineMedium)
        Text(
            stringResource(R.string.login_subtitle),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )

        if (!state.codeSent) {
            OutlinedTextField(
                value = state.phone,
                onValueChange = onPhoneChange,
                label = { Text(stringResource(R.string.login_phone_label)) },
                supportingText = { Text(stringResource(R.string.login_phone_hint)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            PrimaryButton(stringResource(R.string.login_send_code), state.busy) { onSendCode(activity) }
        } else {
            OutlinedTextField(
                value = state.code,
                onValueChange = onCodeChange,
                label = { Text(stringResource(R.string.login_code_label)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            PrimaryButton(stringResource(R.string.login_verify), state.busy, enabled = state.code.length == 6, onVerify)
            TextButton(onClick = onChangeNumber, enabled = !state.busy) {
                Text(stringResource(R.string.login_change_number))
            }
        }

        state.error?.let {
            Text(stringResource(it), color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
        }
        state.errorDetail?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
        }
    }
}

@Composable
fun PrimaryButton(text: String, busy: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier.fillMaxWidth().height(56.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
        } else {
            Text(text)
        }
    }
}
