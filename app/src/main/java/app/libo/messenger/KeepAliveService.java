package app.libo.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Optional foreground service ("Фоновый режим"). It holds no logic of its own: it only
 * keeps the process — and therefore the WebView transport — alive while the app is in
 * the background so that incoming messages can raise notifications.
 */
public final class KeepAliveService extends Service {
    static final String CHANNEL = "libo-keepalive";
    static final int ID = 1;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "LIBO на связи", NotificationManager.IMPORTANCE_MIN);
            channel.setDescription("Держит соединение, чтобы сообщения приходили в фоне");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("LIBO на связи")
                .setContentText("Сообщения придут, даже когда приложение свёрнуто")
                .setOngoing(true)
                .setContentIntent(tap)
                .setVisibility(Notification.VISIBILITY_SECRET)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification, 0);
        else startForeground(ID, notification);
        return START_STICKY;
    }
}
