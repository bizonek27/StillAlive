package app.stillalive.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.stillalive.R
import app.stillalive.data.ALLOW_DUPLICATE_CONTACT_PHONES
import app.stillalive.data.Address
import app.stillalive.data.Contact
import app.stillalive.data.ContactKind
import app.stillalive.data.DEFAULT_ESCALATE_AFTER_MINUTES
import app.stillalive.data.DEFAULT_REMINDER_INTERVAL_MINUTES
import app.stillalive.data.DEFAULT_POLICE_AFTER_HOURS
import app.stillalive.data.ESCALATE_AFTER_MAX_HOURS
import app.stillalive.data.ESCALATE_AFTER_MIN_MINUTES
import app.stillalive.data.ESCALATE_AFTER_STEP_MINUTES
import app.stillalive.data.MAX_FAMILY_CONTACTS
import app.stillalive.data.MAX_WORK_CONTACTS
import app.stillalive.data.REMINDERS_BEFORE_SMS
import app.stillalive.data.REMINDER_INTERVAL_OPTIONS_MINUTES
import app.stillalive.data.ProfileInput
import app.stillalive.data.normalizePhone

/**
 * Profile editor. With [onboarding] it is the first screen after sign-in and has no way back.
 */
@Composable
fun SettingsScreen(
    initial: ProfileInput?,
    onboarding: Boolean,
    busy: Boolean,
    onSave: (ProfileInput) -> Unit,
    onBack: () -> Unit,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
) {
    val initialAddress = initial?.address ?: Address()
    var name by rememberSaveable { mutableStateOf(initial?.displayName.orEmpty()) }
    var street by rememberSaveable { mutableStateOf(initialAddress.street) }
    var building by rememberSaveable { mutableStateOf(initialAddress.building) }
    var apartment by rememberSaveable { mutableStateOf(initialAddress.apartment) }
    var postalCode by rememberSaveable { mutableStateOf(initialAddress.postalCode) }
    var city by rememberSaveable { mutableStateOf(initialAddress.city) }
    var addressNotes by rememberSaveable { mutableStateOf(initialAddress.notes) }
    var checkInHour by rememberSaveable { mutableIntStateOf(initial?.checkInHour ?: 10) }
    var checkInMinute by rememberSaveable { mutableIntStateOf(initial?.checkInMinute ?: 0) }
    var reminderInterval by rememberSaveable {
        mutableIntStateOf(initial?.reminderIntervalMinutes ?: DEFAULT_REMINDER_INTERVAL_MINUTES)
    }
    var quietStart by rememberSaveable { mutableIntStateOf(initial?.quietStartHour ?: 22) }
    var quietEnd by rememberSaveable { mutableIntStateOf(initial?.quietEndHour ?: 8) }
    var escalateAfter by rememberSaveable {
        mutableIntStateOf(initial?.escalateAfterMinutes ?: DEFAULT_ESCALATE_AFTER_MINUTES)
    }
    // Police is not offered in the app for now; keep whatever was stored.
    val policeAfter = initial?.policeAfterHours ?: DEFAULT_POLICE_AFTER_HOURS
    val contacts = remember { mutableStateListOf<Contact>().apply { addAll(initial?.contacts.orEmpty()) } }

    var showErrors by remember { mutableStateOf(false) }
    var showTimePicker by remember { mutableStateOf(false) }
    /** Contact being added or edited; null when the dialog is closed. */
    var contactDraft by remember { mutableStateOf<ContactDraft?>(null) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    val address = Address(street, building, apartment, postalCode, city, addressNotes).trimmed()
    val familyCount = contacts.count { it.kind == ContactKind.FAMILY }
    val workCount = contacts.count { it.kind == ContactKind.WORK }

    BackHandler(enabled = !onboarding, onBack = onBack)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!onboarding) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                }
            }
            Text(
                stringResource(if (onboarding) R.string.settings_welcome else R.string.settings_title),
                style = MaterialTheme.typography.headlineSmall,
            )
        }

        TextInput(
            value = name,
            onValueChange = { name = it },
            label = stringResource(R.string.settings_name),
            error = showErrors && name.isBlank(),
            capitalization = KeyboardCapitalization.Words,
        )

        // ---------- Address ----------
        HorizontalDivider()
        SectionTitle(stringResource(R.string.settings_address))
        Text(stringResource(R.string.settings_address_hint), style = MaterialTheme.typography.bodyMedium)
        TextInput(
            value = street,
            onValueChange = { street = it },
            label = stringResource(R.string.address_street),
            error = showErrors && street.isBlank(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextInput(
                value = building,
                onValueChange = { building = it },
                label = stringResource(R.string.address_building),
                error = showErrors && building.isBlank(),
                modifier = Modifier.weight(1f),
            )
            TextInput(
                value = apartment,
                onValueChange = { apartment = it },
                label = stringResource(R.string.address_apartment),
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextInput(
                value = postalCode,
                onValueChange = { postalCode = it },
                label = stringResource(R.string.address_postal_code),
                error = showErrors && postalCode.isBlank(),
                modifier = Modifier.weight(1f),
            )
            TextInput(
                value = city,
                onValueChange = { city = it },
                label = stringResource(R.string.address_city),
                error = showErrors && city.isBlank(),
                modifier = Modifier.weight(1.6f),
            )
        }
        OutlinedTextField(
            value = addressNotes,
            onValueChange = { addressNotes = it },
            label = { Text(stringResource(R.string.address_notes)) },
            supportingText = { Text(stringResource(R.string.address_notes_hint)) },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )

        // ---------- Schedule ----------
        HorizontalDivider()
        SectionTitle(stringResource(R.string.settings_schedule))
        Text(stringResource(R.string.settings_checkin_time), style = MaterialTheme.typography.bodyLarge)
        OutlinedButton(onClick = { showTimePicker = true }, modifier = Modifier.fillMaxWidth().height(56.dp)) {
            Text(formatTime(checkInHour, checkInMinute), style = MaterialTheme.typography.titleLarge)
        }
        OptionStepper(
            label = stringResource(R.string.settings_reminder_interval),
            options = REMINDER_INTERVAL_OPTIONS_MINUTES,
            value = reminderInterval,
            format = { durationLabel(it) },
            onChange = { reminderInterval = it },
        )
        Text(stringResource(R.string.settings_quiet_hours), style = MaterialTheme.typography.bodyLarge)
        HourStepper(stringResource(R.string.settings_quiet_from), quietStart) { quietStart = it }
        HourStepper(stringResource(R.string.settings_quiet_to), quietEnd) { quietEnd = it }
        Text(stringResource(R.string.settings_quiet_note), style = MaterialTheme.typography.bodyMedium)

        // ---------- Escalation ----------
        HorizontalDivider()
        SectionTitle(stringResource(R.string.settings_escalation))
        Text(stringResource(R.string.settings_escalate_after), style = MaterialTheme.typography.bodyLarge)
        DurationStepper(minutes = escalateAfter, onChange = { escalateAfter = it })
        Text(
            stringResource(
                R.string.settings_escalation_summary,
                REMINDERS_BEFORE_SMS,
                durationLabel(reminderInterval),
                durationLabel(escalateAfter),
            ),
            style = MaterialTheme.typography.bodyMedium,
        )

        // ---------- Contacts ----------
        HorizontalDivider()
        SectionTitle(stringResource(R.string.settings_contacts))
        Text(stringResource(R.string.settings_contacts_hint), style = MaterialTheme.typography.bodyMedium)
        contacts.forEachIndexed { index, contact ->
            ContactRow(
                contact,
                onEdit = { contactDraft = ContactDraft(contact.kind, index) },
                onDelete = { contacts.removeAt(index) },
            )
        }
        if (familyCount < MAX_FAMILY_CONTACTS) {
            AddButton(stringResource(R.string.settings_add_family)) { contactDraft = ContactDraft(ContactKind.FAMILY) }
        }
        if (workCount < MAX_WORK_CONTACTS) {
            AddButton(stringResource(R.string.settings_add_work)) { contactDraft = ContactDraft(ContactKind.WORK) }
        }

        Spacer(Modifier.height(8.dp))
        PrimaryButton(stringResource(R.string.settings_save), busy) {
            if (name.isBlank() || !address.isComplete) {
                showErrors = true
            } else {
                onSave(
                    ProfileInput(
                        displayName = name.trim(),
                        address = address,
                        checkInHour = checkInHour,
                        checkInMinute = checkInMinute,
                        reminderIntervalMinutes = reminderInterval,
                        quietStartHour = quietStart,
                        quietEndHour = quietEnd,
                        escalateAfterMinutes = escalateAfter,
                        policeAfterHours = policeAfter,
                        contacts = contacts.toList(),
                    ),
                )
            }
        }
        if (showErrors && (name.isBlank() || !address.isComplete)) {
            Text(stringResource(R.string.settings_fill_required), color = MaterialTheme.colorScheme.error)
        }

        HorizontalDivider()
        TextButton(onClick = onSignOut) { Text(stringResource(R.string.settings_sign_out)) }
        if (!onboarding) {
            TextButton(onClick = { showDeleteDialog = true }) {
                Text(stringResource(R.string.settings_delete_account), color = MaterialTheme.colorScheme.error)
            }
        }
    }

    if (showTimePicker) {
        TimePickerDialog(
            initialHour = checkInHour,
            initialMinute = checkInMinute,
            onDismiss = { showTimePicker = false },
            onConfirm = { hour, minute ->
                checkInHour = hour
                checkInMinute = minute
                showTimePicker = false
            },
        )
    }
    contactDraft?.let { draft ->
        val editing = draft.index?.let { contacts[it] }
        ContactDialog(
            kind = draft.kind,
            initial = editing,
            otherPhones = contacts.filterIndexed { i, _ -> i != draft.index }.map { it.phone }.toSet(),
            onDismiss = { contactDraft = null },
            onSave = { contact ->
                if (draft.index == null) contacts.add(contact) else contacts[draft.index] = contact
                contactDraft = null
            },
        )
    }
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text(stringResource(R.string.settings_delete_confirm_title)) },
            text = { Text(stringResource(R.string.settings_delete_confirm_text)) },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteDialog = false
                    onDeleteAccount()
                }) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

/** A contact dialog request: a new contact of [kind], or the one at [index] in the list. */
private data class ContactDraft(val kind: ContactKind, val index: Int? = null)

private fun Address.trimmed() = Address(
    street.trim(), building.trim(), apartment.trim(), postalCode.trim(), city.trim(), notes.trim(),
)

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium)
}

@Composable
private fun TextInput(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier.fillMaxWidth(),
    error: Boolean = false,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        isError = error,
        supportingText = if (error) {
            { Text(stringResource(R.string.field_required)) }
        } else null,
        keyboardOptions = KeyboardOptions(capitalization = capitalization),
        singleLine = true,
        modifier = modifier,
    )
}

@Composable
private fun AddButton(text: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Filled.Add, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text(text)
    }
}

@Composable
private fun Stepper(label: String, value: String, onMinus: (() -> Unit)?, onPlus: (() -> Unit)?) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        FilledTonalIconButton(onClick = { onMinus?.invoke() }, enabled = onMinus != null) { Text("−") }
        Text(
            value,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        FilledTonalIconButton(onClick = { onPlus?.invoke() }, enabled = onPlus != null) { Text("+") }
    }
}

@Composable
private fun HourStepper(label: String, hour: Int, onChange: (Int) -> Unit) {
    Stepper(label, formatTime(hour, 0), onMinus = { onChange((hour + 23) % 24) }, onPlus = { onChange((hour + 1) % 24) })
}

/** Steps through [options]; a value not in the list snaps to the nearest option on the first step. */
@Composable
private fun OptionStepper(
    label: String,
    options: List<Int>,
    value: Int,
    format: @Composable (Int) -> String,
    onChange: (Int) -> Unit,
) {
    val lower = options.lastOrNull { it < value }
    val higher = options.firstOrNull { it > value }
    Stepper(
        label,
        format(value),
        onMinus = lower?.let { { onChange(it) } },
        onPlus = higher?.let { { onChange(it) } },
    )
}

/** Hours and minutes as two steppers; the total stays within the server's limits. */
@Composable
private fun DurationStepper(minutes: Int, onChange: (Int) -> Unit) {
    val hours = minutes / 60
    val rest = minutes % 60
    val min = ESCALATE_AFTER_MIN_MINUTES
    val max = ESCALATE_AFTER_MAX_HOURS * 60
    val step = ESCALATE_AFTER_STEP_MINUTES
    fun change(total: Int) = onChange(total.coerceIn(min, max))
    Stepper(
        stringResource(R.string.duration_hours),
        stringResource(R.string.hours_value, hours),
        onMinus = if (hours > 0) ({ change(minutes - 60) }) else null,
        onPlus = if (minutes + 60 <= max) ({ change(minutes + 60) }) else null,
    )
    Stepper(
        stringResource(R.string.duration_minutes),
        stringResource(R.string.minutes_value, rest),
        onMinus = if (minutes - step >= min) ({ change(minutes - step) }) else null,
        onPlus = if (minutes + step <= max) ({ change(minutes + step) }) else null,
    )
}

@Composable
private fun durationLabel(minutes: Int): String {
    val hours = minutes / 60
    val rest = minutes % 60
    return when {
        hours == 0 -> stringResource(R.string.minutes_value, rest)
        rest == 0 -> stringResource(R.string.hours_value, hours)
        else -> stringResource(R.string.hours_value, hours) + " " + stringResource(R.string.minutes_value, rest)
    }
}

@Composable
private fun ContactRow(contact: Contact, onEdit: () -> Unit, onDelete: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onEdit)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp)) {
            Column(modifier = Modifier.weight(1f).padding(vertical = 12.dp)) {
                Text(contact.name, style = MaterialTheme.typography.titleMedium)
                Text(contact.phone, style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(contact.kind.label), style = MaterialTheme.typography.labelMedium)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.contact_delete))
            }
        }
    }
}

@Composable
private fun ContactDialog(
    kind: ContactKind,
    initial: Contact?,
    otherPhones: Set<String>,
    onDismiss: () -> Unit,
    onSave: (Contact) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(initial?.name.orEmpty()) }
    var phone by rememberSaveable { mutableStateOf(initial?.phone ?: "+48") }
    /** Message for the phone field, or null when there is nothing to complain about. */
    var phoneError by remember { mutableStateOf<Int?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                stringResource(
                    when {
                        initial != null -> R.string.contact_edit
                        kind == ContactKind.WORK -> R.string.settings_add_work
                        else -> R.string.settings_add_family
                    },
                ),
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.contact_name)) },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it; phoneError = null },
                    label = { Text(stringResource(R.string.contact_phone)) },
                    isError = phoneError != null,
                    supportingText = phoneError?.let { error -> { Text(stringResource(error)) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                )
                if (kind == ContactKind.WORK) {
                    Text(stringResource(R.string.contact_work_hint), style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank(),
                onClick = {
                    val normalized = normalizePhone(phone)
                    phoneError = when {
                        normalized == null -> R.string.contact_invalid_phone
                        !ALLOW_DUPLICATE_CONTACT_PHONES && normalized in otherPhones -> R.string.contact_duplicate_phone
                        else -> null
                    }
                    if (normalized != null && phoneError == null) onSave(Contact(name.trim(), normalized, kind))
                },
            ) { Text(stringResource(R.string.ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimePickerDialog(
    initialHour: Int,
    initialMinute: Int,
    onDismiss: () -> Unit,
    onConfirm: (hour: Int, minute: Int) -> Unit,
) {
    val state = rememberTimePickerState(initialHour = initialHour, initialMinute = initialMinute, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onConfirm(state.hour, state.minute) }) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
        text = { TimePicker(state = state) },
    )
}

private val ContactKind.label: Int
    get() = when (this) {
        ContactKind.FAMILY -> R.string.contact_kind_family
        ContactKind.WORK -> R.string.contact_kind_work
        ContactKind.POLICE -> R.string.contact_kind_police
    }

private fun formatTime(hour: Int, minute: Int) = "%02d:%02d".format(hour, minute)
