package app.libo.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import app.libo.android.data.LiboStore
import app.libo.android.ui.LiboApp
import app.libo.android.ui.LiboTheme

class MainActivity : ComponentActivity() {
    private lateinit var store: LiboStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        store = LiboStore(applicationContext)
        setContent {
            LiboTheme(darkTheme = store.state.settings.darkTheme) {
                LiboApp(store = store)
            }
        }
    }
}
