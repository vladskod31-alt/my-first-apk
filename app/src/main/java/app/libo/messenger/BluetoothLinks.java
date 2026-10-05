package app.libo.messenger;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * Bluetooth Classic (RFCOMM) point-to-point links for LIBO.
 *
 * The radio only carries opaque, newline-delimited JSON frames. Every frame that
 * matters is produced by the web layer's existing transport: the same signed
 * E2EE hello, the same Double Ratchet packets as over WebRTC. This class adds no
 * cryptography of its own and never sees plaintext messages after the handshake.
 *
 * Preamble: each side writes {@code LIBO1 <personal-code>} as the first line so the
 * web layer can bind the socket to a contact before the authenticated hello runs.
 * The personal code is public (it is what people share to be reachable).
 */
final class BluetoothLinks {
    interface Sink { void emit(JSONObject event); }

    static final UUID SERVICE_UUID = UUID.fromString("7c5c3a52-6b0e-4d41-9a3b-0b1b0f3a1b07");
    private static final String SERVICE_NAME = "LIBO";
    private static final int MAX_LINE = 2 * 1024 * 1024;         // 2 MB — a compressed photo frame
    private static final int MAX_LINKS = 6;
    private static final Pattern PEER_ID = Pattern.compile("^libo-[a-f0-9]{32}$");
    static final int REQUEST_PERMISSIONS = 210;
    static final int REQUEST_ENABLE = 211;
    static final int REQUEST_DISCOVERABLE = 212;

    private final Activity activity;
    private final Sink sink;
    private final BluetoothAdapter adapter;
    private final Map<Integer, Link> links = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);
    private volatile String myId;
    private volatile BluetoothServerSocket server;
    private Thread acceptThread;
    private BroadcastReceiver receiver;

    BluetoothLinks(Activity activity, Sink sink) {
        this.activity = activity;
        this.sink = sink;
        BluetoothManager manager = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        this.adapter = manager == null ? null : manager.getAdapter();
    }

    boolean available() { return adapter != null; }
    // Permission can be revoked between hasPermissions() and a platform call.
    boolean enabled() {
        try { return adapter != null && adapter.isEnabled(); }
        catch (SecurityException denied) { return false; }
    }

    String[] requiredPermissions() {
        if (Build.VERSION.SDK_INT >= 31) {
            return new String[]{Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE};
        }
        return new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};
    }

    boolean hasPermissions() {
        for (String permission : requiredPermissions()) {
            if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    void requestPermissions() { activity.requestPermissions(requiredPermissions(), REQUEST_PERMISSIONS); }

    JSONObject status() {
        JSONObject out = new JSONObject();
        try {
            out.put("available", adapter != null);
            out.put("enabled", adapter != null && enabled());
            out.put("permitted", adapter != null && hasPermissions());
            out.put("listening", server != null);
            out.put("links", links.size());
            String name = null;
            try { if (adapter != null && hasPermissions()) name = adapter.getName(); } catch (SecurityException ignored) { }
            out.put("name", name == null ? "" : name);
        } catch (JSONException ignored) { }
        return out;
    }

    /** Start the RFCOMM server for this personal code. Idempotent. */
    synchronized boolean start(String id) {
        if (adapter == null || !PEER_ID.matcher(id).matches() || !hasPermissions()) return false;
        myId = id;
        if (!enabled()) {
            try { activity.startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQUEST_ENABLE); }
            catch (Exception ignored) { }
            return false;
        }
        if (server != null) return true;
        try {
            server = adapter.listenUsingRfcommWithServiceRecord(SERVICE_NAME, SERVICE_UUID);
        } catch (IOException | SecurityException error) {
            server = null;
            try { emit(event("error").put("message", "Не удалось открыть Bluetooth-канал")); } catch (JSONException ignored) { }
            return false;
        }
        final BluetoothServerSocket socket = server;
        acceptThread = new Thread(new Runnable() { @Override public void run() {
            while (server == socket) {
                try {
                    BluetoothSocket client = socket.accept();
                    if (links.size() >= MAX_LINKS) { closeQuietly(client); continue; }
                    handshake(client, true);
                } catch (IOException closed) { break; }
            }
        }}, "libo-bt-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        registerReceiver();
        try { emit(event("status").put("status", status())); } catch (JSONException ignored) { }
        return true;
    }

    void makeDiscoverable() {
        if (adapter == null) return;
        try {
            Intent intent = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
            intent.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
            activity.startActivityForResult(intent, REQUEST_DISCOVERABLE);
        } catch (Exception ignored) { }
    }

    boolean scan() {
        if (adapter == null || !hasPermissions() || !enabled()) return false;
        registerReceiver();
        try {
            JSONArray bonded = new JSONArray();
            Set<BluetoothDevice> paired = adapter.getBondedDevices();
            if (paired != null) for (BluetoothDevice device : paired) bonded.put(describe(device, true));
            emit(event("devices").put("devices", bonded).put("bonded", true));
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
            boolean started = adapter.startDiscovery();
            emit(event("scan").put("active", started));
            return started;
        } catch (SecurityException | JSONException error) { return false; }
    }

    void stopScan() {
        try { if (adapter != null && hasPermissions() && adapter.isDiscovering()) adapter.cancelDiscovery(); } catch (SecurityException ignored) { }
    }

    boolean connect(String address) {
        if (adapter == null || !hasPermissions() || !BluetoothAdapter.checkBluetoothAddress(address) || links.size() >= MAX_LINKS) return false;
        stopScan();
        final BluetoothDevice device = adapter.getRemoteDevice(address);
        Thread thread = new Thread(new Runnable() { @Override public void run() {
            BluetoothSocket socket = null;
            try {
                socket = device.createRfcommSocketToServiceRecord(SERVICE_UUID);
                socket.connect();
                handshake(socket, false);
            } catch (IOException | SecurityException error) {
                closeQuietly(socket);
                try { emit(event("connect-failed").put("address", address).put("name", safeName(device))); } catch (JSONException ignored) { }
            }
        }}, "libo-bt-dial");
        thread.setDaemon(true);
        thread.start();
        return true;
    }

    boolean send(int link, String json) {
        Link target = links.get(link);
        if (target == null || json == null || json.length() > MAX_LINE) return false;
        return target.write(json);
    }

    void close(int link) {
        Link target = links.remove(link);
        if (target != null) target.close(true);
    }

    synchronized void stop() {
        stopScan();
        BluetoothServerSocket socket = server;
        server = null;
        if (socket != null) try { socket.close(); } catch (IOException ignored) { }
        for (Integer id : new ArrayList<>(links.keySet())) close(id);
        if (receiver != null) {
            try { activity.unregisterReceiver(receiver); } catch (IllegalArgumentException ignored) { }
            receiver = null;
        }
    }

    // ---- internals ----------------------------------------------------------------

    private void handshake(BluetoothSocket socket, boolean incoming) {
        String id = myId;
        if (id == null) { closeQuietly(socket); return; }
        try {
            OutputStream out = socket.getOutputStream();
            out.write(("LIBO1 " + id + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8), 64 * 1024);
            String first = readLine(reader);
            if (first == null || !first.startsWith("LIBO1 ")) { closeQuietly(socket); return; }
            String peer = first.substring(6).trim();
            if (!PEER_ID.matcher(peer).matches() || peer.equals(id)) { closeQuietly(socket); return; }
            Link link = new Link(nextId.getAndIncrement(), socket, reader, out, peer, incoming);
            links.put(link.id, link);
            emit(event("open").put("link", link.id).put("peer", peer).put("incoming", incoming)
                    .put("address", socket.getRemoteDevice().getAddress()).put("name", safeName(socket.getRemoteDevice())));
            link.readLoop();
        } catch (IOException | JSONException | SecurityException error) {
            closeQuietly(socket);
        }
    }

    /** Line reader with a hard cap so a hostile peer cannot exhaust memory. */
    private static String readLine(BufferedReader reader) throws IOException {
        StringBuilder sb = new StringBuilder(256);
        int ch;
        while ((ch = reader.read()) != -1) {
            if (ch == '\n') return sb.toString();
            if (ch != '\r') sb.append((char) ch);
            if (sb.length() > MAX_LINE) throw new IOException("frame too large");
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private final class Link {
        final int id;
        final BluetoothSocket socket;
        final BufferedReader reader;
        final OutputStream out;
        final String peer;
        final boolean incoming;
        private volatile boolean closed;

        Link(int id, BluetoothSocket socket, BufferedReader reader, OutputStream out, String peer, boolean incoming) {
            this.id = id; this.socket = socket; this.reader = reader; this.out = out; this.peer = peer; this.incoming = incoming;
        }

        void readLoop() {
            try {
                String line;
                while (!closed && (line = readLine(reader)) != null) {
                    if (line.isEmpty()) continue;
                    emit(event("data").put("link", id).put("json", line));
                }
            } catch (IOException | JSONException ignored) {
            } finally { close(false); }
        }

        boolean write(String json) {
            if (closed) return false;
            synchronized (out) {
                try {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                    out.write('\n');
                    out.flush();
                    return true;
                } catch (IOException error) { close(false); return false; }
            }
        }

        void close(boolean silent) {
            if (closed) return;
            closed = true;
            links.remove(id);
            closeQuietly(socket);
            try { emit(event("close").put("link", id).put("peer", peer)); } catch (JSONException ignored) { }
        }
    }

    private void registerReceiver() {
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                try {
                    if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                        if (device == null) return;
                        JSONArray one = new JSONArray().put(describe(device, device.getBondState() == BluetoothDevice.BOND_BONDED));
                        emit(event("devices").put("devices", one).put("bonded", false));
                    } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                        emit(event("scan").put("active", false));
                    } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                        int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
                        if (state == BluetoothAdapter.STATE_ON && myId != null && server == null) start(myId);
                        if (state == BluetoothAdapter.STATE_OFF) { for (Integer id : new ArrayList<>(links.keySet())) close(id); }
                        emit(event("status").put("status", status()));
                    }
                } catch (JSONException | SecurityException ignored) { }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        else activity.registerReceiver(receiver, filter);
    }

    private JSONObject describe(BluetoothDevice device, boolean bonded) throws JSONException {
        return new JSONObject().put("address", device.getAddress()).put("name", safeName(device)).put("bonded", bonded);
    }

    private String safeName(BluetoothDevice device) {
        try { String name = device.getName(); return name == null ? "" : name; } catch (SecurityException e) { return ""; }
    }

    private static JSONObject event(String type) {
        try { return new JSONObject().put("ev", type); } catch (JSONException impossible) { return new JSONObject(); }
    }

    private void emit(JSONObject event) { sink.emit(event); }

    private static void closeQuietly(BluetoothSocket socket) {
        if (socket != null) try { socket.close(); } catch (IOException ignored) { }
    }

    List<Integer> linkIds() { return new ArrayList<>(links.keySet()); }
}
