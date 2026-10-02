package app.libo.messenger;

import android.app.ForegroundServiceStartNotAllowedException;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Opt-in foreground service (settings switch "Фоновий режим") that keeps the process
 * — and therefore the WebView peer connections — alive while LIBO is in the
 * background, so message notifications can actually arrive. Without FCM there is no
 * other way to wake the app; the trade-off is a persistent notification, which is
 * exactly how the plan in KNOWN_ISSUES.md described it.
 *
 * The service holds no state of its own: MainActivity reports status/unread changes
 * with {@link #update(Context, String, int)} and the notification is the only UI.
 */
public final class ConnectionService extends Service {
    private static final String ACTION_START = "app.libo.messenger.KEEP_ALIVE_START";
    private static final String ACTION_UPDATE = "app.libo.messenger.KEEP_ALIVE_UPDATE";
    private static final String ACTION_STOP = "app.libo.messenger.KEEP_ALIVE_STOP";
    private static final String EXTRA_STATUS = "status";
    private static final String EXTRA_UNREAD = "unread";

    public static boolean running;

    public static void start(Context context, String status) {
        Intent intent = new Intent(context, ConnectionService.class).setAction(ACTION_START)
                .putExtra(EXTRA_STATUS, status);
        tryStart(context, intent);
    }

    public static void update(Context context, String status, int unread) {
        if (!running) return;
        Intent intent = new Intent(context, ConnectionService.class).setAction(ACTION_UPDATE)
                .putExtra(EXTRA_STATUS, status).putExtra(EXTRA_UNREAD, unread);
        try { context.startService(intent); } catch (IllegalStateException ignored) { /* background */ }
    }

    public static void stop(Context context) {
        running = false;
        try { context.startService(new Intent(context, ConnectionService.class).setAction(ACTION_STOP)); }
        catch (IllegalStateException ignored) { /* already stopped */ }
        context.stopService(new Intent(context, ConnectionService.class));
    }

    private static void tryStart(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (IllegalStateException ignored) {
            /* app process in background */
        } catch (RuntimeException notAllowed) {
            if (Build.VERSION.SDK_INT >= 31
                    && notAllowed instanceof ForegroundServiceStartNotAllowedException) {
                // Android 12+: the system refused a background start. The web layer
                // shows the hint; the user can start the service again while visible.
                running = false;
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notifications.ensureChannels(this);
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            running = false;
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        String status = intent.getStringExtra(EXTRA_STATUS);
        if (status == null || status.isEmpty()) status = "Тримаємо з'єднання з собеседниками";
        int unread = intent.getIntExtra(EXTRA_UNREAD, 0);
        running = true;
        startAsForeground(Notifications.serviceNotification(this, status, unread));
        return START_NOT_STICKY;
    }

    private void startAsForeground(android.app.Notification notification) {
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(Notifications.SERVICE_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(Notifications.SERVICE_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
