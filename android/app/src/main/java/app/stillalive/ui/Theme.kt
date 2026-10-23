package app.stillalive.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp

// Fixed, high-contrast palette instead of dynamic color: the confirm button must always look the same.
private val LightColors = lightColorScheme(
    primary = Color(0xFF2E7D32),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFC8E6C9),
    onPrimaryContainer = Color(0xFF0B3D0F),
    error = Color(0xFFB3261E),
    errorContainer = Color(0xFFF9DEDC),
    onErrorContainer = Color(0xFF410E0B),
    tertiaryContainer = Color(0xFFFFE0B2),
    onTertiaryContainer = Color(0xFF4E2600),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF81C784),
    onPrimary = Color(0xFF0B3D0F),
    primaryContainer = Color(0xFF1B5E20),
    onPrimaryContainer = Color(0xFFC8E6C9),
    tertiaryContainer = Color(0xFF6D3A00),
    onTertiaryContainer = Color(0xFFFFE0B2),
)

// Slightly larger body text for readability.
private val BaseTypography = Typography()
private val AppTypography = BaseTypography.copy(
    bodyLarge = BaseTypography.bodyLarge.copy(fontSize = 18.sp, lineHeight = 26.sp),
    bodyMedium = BaseTypography.bodyMedium.copy(fontSize = 16.sp, lineHeight = 22.sp),
    labelLarge = BaseTypography.labelLarge.copy(fontSize = 16.sp),
)

@Composable
fun StillAliveTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = AppTypography,
        content = content,
    )
}
