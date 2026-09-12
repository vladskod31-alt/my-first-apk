package app.libo.messenger;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts only the explicitly enabled notification service, never a new registration. */
public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) MessageSyncService.start(context);
    }
}
