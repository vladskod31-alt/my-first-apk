package app.libo.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LiboDarkColors = darkColorScheme(
    primary = Color(0xFF9A7BFF),
    onPrimary = Color(0xFF160C35),
    primaryContainer = Color(0xFF38236B),
    onPrimaryContainer = Color(0xFFE7DFFF),
    secondary = Color(0xFFB7A4FF),
    tertiary = Color(0xFF74D8CF),
    background = Color(0xFF090913),
    onBackground = Color(0xFFF5F3FA),
    surface = Color(0xFF12121D),
    onSurface = Color(0xFFF5F3FA),
    surfaceVariant = Color(0xFF1D1C2A),
    onSurfaceVariant = Color(0xFFB8B5C7),
    outline = Color(0xFF343244),
    error = Color(0xFFFF7A8C),
)

private val LiboLightColors = lightColorScheme(
    primary = Color(0xFF6545D5),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEAE2FF),
    onPrimaryContainer = Color(0xFF241050),
    secondary = Color(0xFF614DB8),
    tertiary = Color(0xFF087A78),
    background = Color(0xFFF7F6FB),
    onBackground = Color(0xFF181622),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF181622),
    surfaceVariant = Color(0xFFECEAF2),
    onSurfaceVariant = Color(0xFF5D5A69),
    outline = Color(0xFFD0CDD9),
    error = Color(0xFFBA1A1A),
)

@Composable
fun LiboTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) LiboDarkColors else LiboLightColors,
        content = content,
    )
}
