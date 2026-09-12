package app.libo.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Opt-in foreground connection. No Firebase keys or message plaintext are stored here. */
public final class MessageSyncService extends Service {
    private static final String CONNECTION_CHANNEL = "libo_connection_23";
    private static final String MESSAGE_CHANNEL = "libo_messages_23";
    private static final int CONNECTION_NOTIFICATION = 2301;
    private static final int MESSAGE_NOTIFICATION = 2302;
    public static volatile boolean running = false;
    public static volatile boolean connected = false;
    private volatile boolean alive = false;
    private volatile int generation = 0;
    private volatile HttpsURLConnection connection;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;

    public static boolean notificationPermission(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) && manager != null && manager.areNotificationsEnabled();
    }
    public static void start(Context context) {
        if (!notificationPermission(context) || BackgroundPreferences.load(context) == null) return;
        try { context.startForegroundService(new Intent(context, MessageSyncService.class)); }
        catch (RuntimeException ignored) { /* Android may require the user to reopen the app. */ }
    }
    public static void stop(Context context) { context.stopService(new Intent(context, MessageSyncService.class)); }
    public static void clearMessages(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(MESSAGE_NOTIFICATION);
        BackgroundPreferences.preferences(context).edit().putInt("unread", 0).apply();
    }
    private String text(String ru, String uk, String en) {
        String language = getSharedPreferences("privacy", MODE_PRIVATE).getString("language", "ru");
        return "uk".equals(language) ? uk : "en".equals(language) ? en : ru;
    }
    private void channels() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel ongoing = new NotificationChannel(CONNECTION_CHANNEL, text("Фоновое соединение", "Фонове з’єднання", "Background connection"), NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription(text("Постоянное соединение с вашим сервером сообщений", "Постійне з’єднання з вашим сервером повідомлень", "Persistent connection to your message server"));
        ongoing.setShowBadge(false); manager.createNotificationChannel(ongoing);
        NotificationChannel messages = new NotificationChannel(MESSAGE_CHANNEL, text("Сообщения", "Повідомлення", "Messages"), NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription(text("Новые сообщения без раскрытия текста на заблокированном экране", "Нові повідомлення без розкриття тексту на заблокованому екрані", "New messages without exposing text on the lock screen"));
        messages.enableVibration(true); messages.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE); manager.createNotificationChannel(messages);
    }
    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class); intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 2300, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification connectionNotification() {
        Notification.Builder builder = new Notification.Builder(this, CONNECTION_CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("LIBO 2.3").setContentText(connected
                        ? text("Фоновая доставка включена", "Фонову доставку ввімкнено", "Background delivery is on")
                        : text("Ожидаем соединения с вашим сервером", "Очікуємо з’єднання з вашим сервером", "Waiting for your server connection"))
                .setContentIntent(openApp()).setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_SERVICE);
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return builder.build();
    }
    private void reportConnection(boolean value) {
        if (connected == value) return; connected = value;
        if (alive && notificationPermission(this)) {
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(CONNECTION_NOTIFICATION, connectionNotification());
        }
    }
    private void showMessages(int count) {
        if (MainActivity.isForeground || !notificationPermission(this)) return;
        int total = Math.min(999, BackgroundPreferences.preferences(this).getInt("unread", 0) + count);
        BackgroundPreferences.preferences(this).edit().putInt("unread", total).apply();
        Notification.Builder builder = new Notification.Builder(this, MESSAGE_CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("LIBO").setContentText(text("Новое сообщение. Откройте LIBO, чтобы прочитать.", "Нове повідомлення. Відкрийте LIBO, щоб прочитати.", "New message. Open LIBO to read it."))
                .setNumber(total).setCategory(Notification.CATEGORY_MESSAGE).setContentIntent(openApp()).setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(MESSAGE_NOTIFICATION, builder.build());
    }
    @Override public void onCreate() {
        super.onCreate(); channels();
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power != null) { wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LIBO:notificationPoll"); wakeLock.setReferenceCounted(false); }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!notificationPermission(this) || BackgroundPreferences.load(this) == null) { stopSelf(); return START_NOT_STICKY; }
        Notification notification = connectionNotification();
        if (Build.VERSION.SDK_INT >= 34) startForeground(CONNECTION_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(CONNECTION_NOTIFICATION, notification);
        alive = true; running = true; generation++;
        HttpsURLConnection previous = connection; if (previous != null) previous.disconnect();
        if (worker == null || !worker.isAlive()) {
            worker = new Thread(new Runnable() { @Override public void run() { pollLoop(); } }, "libo-message-notices"); worker.start();
        }
        return START_STICKY;
    }
    private void pollLoop() {
        int failures = 0;
        while (alive) {
            JSONObject config = BackgroundPreferences.load(this);
            if (config == null || !notificationPermission(this)) { stopSelf(); break; }
            int currentGeneration = generation;
            HttpsURLConnection active = null;
            try {
                long after = BackgroundPreferences.preferences(this).getLong("cursor", 0);
                URL url = new URL(config.getString("server") + "/notifications?after=" + after);
                active = (HttpsURLConnection) url.openConnection(); connection = active;
                active.setInstanceFollowRedirects(false); active.setConnectTimeout(10000); active.setReadTimeout(35000);
                active.setRequestProperty("Authorization", "Bearer " + config.getString("token")); active.setRequestProperty("Accept", "application/json");
                if (wakeLock != null) wakeLock.acquire(45000);
                int status = active.getResponseCode();
                if (status == 401 || status == 403) { reportConnection(false); stopSelf(); break; }
                if (status != 200) throw new IllegalStateException("Connection unavailable");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try (InputStream input = active.getInputStream()) {
                    byte[] buffer = new byte[1024]; int length;
                    while ((length = input.read(buffer)) != -1) { output.write(buffer, 0, length); if (output.size() > 4096) throw new IllegalStateException("Invalid notice"); }
                }
                JSONObject result = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
                long cursor = result.getLong("cursor"); int count = result.getInt("count");
                if (cursor < after || cursor > 9007199254740991L || count < 0 || count > 1000000) throw new IllegalStateException("Invalid notice");
                if (!alive || generation != currentGeneration) continue;
                reportConnection(true); failures = 0;
                // These are only notification cursors. Message delivery/read ACKs require client persistence/decryption.
                if (cursor > after) {
                    if (!BackgroundPreferences.preferences(this).edit().putLong("cursor", cursor).commit()) throw new IllegalStateException("Storage unavailable");
                    if (count > 0) showMessages(count);
                }
            } catch (Exception ignored) {
                if (!alive) break; failures++; reportConnection(false);
            } finally {
                if (active != null) active.disconnect(); if (connection == active) connection = null;
                try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (RuntimeException ignored) { }
            }
            try { Thread.sleep(failures == 0 ? 1000 : Math.min(60000, 3000L * (1L << Math.min(failures, 4)))); }
            catch (InterruptedException ignored) { if (!alive) break; }
        }
        running = false; connected = false;
    }
    @Override public void onDestroy() {
        alive = false; generation++; running = false; connected = false;
        HttpsURLConnection previous = connection; if (previous != null) previous.disconnect();
        if (worker != null) worker.interrupt();
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (RuntimeException ignored) { }
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
