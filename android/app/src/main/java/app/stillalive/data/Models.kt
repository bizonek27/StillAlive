package app.stillalive.data

import java.util.Date

enum class CheckState(val wire: String) {
    OK("ok"), PENDING("pending"), ESCALATED("escalated");

    companion object {
        fun fromWire(value: String?) = entries.firstOrNull { it.wire == value } ?: OK
    }
}

enum class ContactKind(val wire: String) {
    FAMILY("family"), WORK("work"),

    /** Not offered in the app for now; kept so stored contacts still load. */
    POLICE("police");

    companion object {
        fun fromWire(value: String?) = entries.firstOrNull { it.wire == value } ?: FAMILY
    }
}

data class Contact(val name: String, val phone: String, val kind: ContactKind)

data class Address(
    val street: String = "",
    val building: String = "",
    val apartment: String = "",
    val postalCode: String = "",
    val city: String = "",
    /** Floor, intercom code, who has a spare key… */
    val notes: String = "",
) {
    val isComplete get() = listOf(street, building, postalCode, city).all { it.isNotBlank() }
}

/** Fields the user edits. Mirrors `ProfileInput` in functions/src/validation.ts. */
data class ProfileInput(
    val displayName: String,
    val address: Address,
    val checkInHour: Int,
    val checkInMinute: Int,
    /** Minutes between reminders after a missed daily question. */
    val reminderIntervalMinutes: Int,
    val quietStartHour: Int,
    val quietEndHour: Int,
    /** Delay after the 3rd reminder before the SMS to the person, and again before the alarm. */
    val escalateAfterMinutes: Int,
    /** Hours after the family is notified. */
    val policeAfterHours: Int,
    val contacts: List<Contact>,
)

/** The user's document in Firestore, `users/{uid}`. */
data class UserProfile(
    val input: ProfileInput,
    val phone: String,
    val state: CheckState,
    val lastConfirmedAt: Date?,
    val nextDueAt: Date?,
)

// Limits mirror functions/src/validation.ts.
const val MAX_FAMILY_CONTACTS = 2
const val MAX_WORK_CONTACTS = 1

/** Testing aid: lets one phone stand in for several contacts. Turn off before release (mirrors validation.ts). */
const val ALLOW_DUPLICATE_CONTACT_PHONES = true

/** Mirrors ALLOWED_REMINDER_INTERVALS_MINUTES in functions/src/schedule.ts. */
val REMINDER_INTERVAL_OPTIONS_MINUTES = listOf(30, 60, 120, 180, 240)
/** Mirrors ESCALATE_AFTER_MINUTES in functions/src/validation.ts; the server checks every 5 minutes. */
const val ESCALATE_AFTER_MIN_MINUTES = 5
const val ESCALATE_AFTER_MAX_HOURS = 48
const val ESCALATE_AFTER_STEP_MINUTES = 5

/** Reminders after the daily question before the person gets an SMS (functions/src/schedule.ts). */
const val REMINDERS_BEFORE_SMS = 3

const val DEFAULT_REMINDER_INTERVAL_MINUTES = 60
const val DEFAULT_ESCALATE_AFTER_MINUTES = 60
const val DEFAULT_POLICE_AFTER_HOURS = 24

private val E164 = Regex("^\\+[1-9]\\d{6,14}$")

/**
 * Turns what people type or paste ("600 123 456", "+48 600-123-456", "0048…") into E.164,
 * or null if it is not a valid number. Nine digits without a prefix are taken as a Polish number.
 */
fun normalizePhone(raw: String): String? {
    val text = raw.trim()
    val digits = text.filter(Char::isDigit)
    val e164 = when {
        text.startsWith("+") -> "+$digits"
        digits.startsWith("00") -> "+${digits.drop(2)}"
        digits.length == 9 -> "+48$digits"
        digits.length == 11 && digits.startsWith("48") -> "+$digits"
        else -> return null
    }
    return e164.takeIf { E164.matches(it) }
}
