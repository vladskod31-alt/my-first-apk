package app.libo.messenger;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Delivers a locally scheduled reminder; no message content is sent to a server. */
public final class ReminderReceiver extends BroadcastReceiver {
    public static final String CHANNEL_ID = "libo-reminders";
    public static final String EXTRA_CHAT_ID = "chatId";
    public static final String EXTRA_MESSAGE_ID = "messageId";

    @Override public void onReceive(Context context, Intent intent) {
        String title = bounded(intent.getStringExtra("title"), 80, "LIBO: напоминание");
        String body = bounded(intent.getStringExtra("body"), 220, "Откройте сообщение в LIBO.");
        String reminderId = bounded(intent.getStringExtra("reminderId"), 96, "reminder");
        String chatId = bounded(intent.getStringExtra(EXTRA_CHAT_ID), 128, "");
        String messageId = bounded(intent.getStringExtra(EXTRA_MESSAGE_ID), 128, "");

        Intent open = new Intent(context, MainActivity.class)
                .setAction("app.libo.messenger.REMINDER")
                .putExtra(EXTRA_CHAT_ID, chatId)
                .putExtra(EXTRA_MESSAGE_ID, messageId)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(context, reminderId.hashCode(), open, flags);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Напоминания LIBO", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Локальные напоминания о сообщениях LIBO");
            manager.createNotificationChannel(channel);
        }
        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new android.app.Notification.Builder(context, CHANNEL_ID)
                : new android.app.Notification.Builder(context);
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new android.app.Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(content);
        manager.notify(reminderId.hashCode(), builder.build());
    }

    private static String bounded(String value, int max, String fallback) {
        if (value == null) return fallback;
        String clean = value.replaceAll("[\\u0000-\\u001f\\u007f]", " ").trim();
        return clean.isEmpty() ? fallback : clean.substring(0, Math.min(max, clean.length()));
    }
}
