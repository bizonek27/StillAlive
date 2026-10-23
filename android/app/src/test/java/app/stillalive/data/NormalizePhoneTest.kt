package app.stillalive.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NormalizePhoneTest {
    @Test
    fun acceptsCommonPolishFormats() {
        listOf(
            "600123456", "600 123 456", "600-123-456", "+48 600 123 456", "+48600123456",
            "48600123456", "0048 600 123 456", "+48 600 123 456", " (+48) 600 123 456 ",
        ).forEach { assertEquals(it, "+48600123456", normalizePhone(it)) }
    }

    @Test
    fun keepsOtherCountries() {
        assertEquals("+447700900123", normalizePhone("+44 7700 900123"))
        assertEquals("+447700900123", normalizePhone("0044 7700 900123"))
    }

    @Test
    fun rejectsInvalidNumbers() {
        listOf("", "+48", "12345", "112", "abc", "60012345").forEach { assertNull(it, normalizePhone(it)) }
    }
}
