package app.libo.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * Notification plumbing for 2.8.7. Before this release LIBO had no system
 * notifications at all: the limitation is documented in KNOWN_ISSUES.md and the UI
 * said "оба собеседника должны быть в приложении". Now an incoming message posted
 * while the app is in the background raises a real notification, and the optional
 * keep-alive service shows a persistent one with the unread count.
 */
final class Notifications {
    static final String CHANNEL_MESSAGES = "libo-messages";
    static final String CHANNEL_SERVICE = "libo-service";
    static final int SERVICE_ID = 9001;
    private static final int MESSAGE_ID = 1101;

    private Notifications() {
    }

    static void ensureChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel messages = new NotificationChannel(CHANNEL_MESSAGES,
                "Повідомлення", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("Нові повідомлення у особистих чатах LIBO");
        messages.enableVibration(true);
        messages.setShowBadge(true);
        NotificationChannel service = new NotificationChannel(CHANNEL_SERVICE,
                "Фоновий режим", NotificationManager.IMPORTANCE_LOW);
        service.setDescription("Постійне сповіщення, поки LIBO тримає з'єднання у фоні");
        service.setShowBadge(false);
        manager.createNotificationChannel(messages);
        manager.createNotificationChannel(service);
    }

    static boolean permissionGranted(Context context) {
        if (Build.VERSION.SDK_INT < 33) return true;
        return context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    static boolean areEnabled(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && manager.areNotificationsEnabled() && permissionGranted(context);
    }

    static void showMessage(Context context, String title, String text, int badge) {
        if (!areEnabled(context)) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        Notification.Builder builder = new Notification.Builder(context, CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setColor(0xFF6D28D9)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setShowWhen(true)
                .setContentIntent(contentIntent(context));
        if (badge > 0) builder.setNumber(badge);
        manager.notify(MESSAGE_ID, builder.build());
    }

    static void cancelMessages(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(MESSAGE_ID);
    }

    static Notification serviceNotification(Context context, String status, int unread) {
        Notification.Builder builder = new Notification.Builder(context, CHANNEL_SERVICE)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("LIBO у мережі")
                .setContentText(status)
                .setColor(0xFF6D28D9)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(contentIntent(context));
        if (unread > 0) builder.setNumber(unread);
        return builder.build();
    }

    private static PendingIntent contentIntent(Context context) {
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, 0, open, flags);
    }
}
