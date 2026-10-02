package app.libo.messenger;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.ParcelUuid;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bluetooth P2P transport for LIBO direct messages (2.8.7).
 *
 * Design:
 * <ul>
 *   <li><b>Classic RFCOMM</b> carries the data: a length-prefixed UTF-8 JSON frame per
 *       packet, so the web layer can reuse the exact protocol it already speaks over
 *       WebRTC (hello, MT envelopes, messages, acks).</li>
 *   <li><b>Discovery</b> combines classic discovery (works everywhere) with BLE
 *       scanning filtered by the LIBO service UUID; where advertising is available the
 *       device also broadcasts its 8-hex short id in the service data, so a neighbour
 *       can label a found device before connecting.</li>
 *   <li>Every event is pushed to the WebView as JSON through
 *       {@code window.LiboBluetooth.onEvent(...)}, and the web side wraps a socket in a
 *       PeerJS-shaped connection object, so chats, the MT layer and delivery acks work
 *       unchanged over Bluetooth.</li>
 * </ul>
 *
 * The transport is proximity-only (roughly 10-100 m) and needs both apps open, exactly
 * like the WebRTC transport; it exists for the case where there is no internet at all.
 */
final class BluetoothP2P {
    interface Listener {
        void onEvent(String json);
    }

    static final UUID SERVICE_UUID = UUID.fromString("6c69626f-2d32-4837-9a4e-8f5c0d1e2b3a");
    private static final String NAME_PREFIX = "LIBO-";
    private static final int MAX_FRAME = 8_000_000;

    private final Activity activity;
    private final Listener listener;
    // Keyed by socket token: two sockets to the same device address can coexist for a
    // moment when both devices dial each other; the web layer tie-breaks and closes one.
    private final Map<Integer, Link> links = new LinkedHashMap<>();
    private final AtomicInteger tokenSeq = new AtomicInteger(1);
    private final Map<String, JSONObject> found = new LinkedHashMap<>();
    private final BluetoothAdapter adapter;
    private Thread acceptThread;
    private BluetoothServerSocket serverSocket;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private AdvertiseCallback advertiseCallback;
    private BroadcastReceiver discoveryReceiver;
    private String shortId = "";
    private volatile String listenError = "";

    BluetoothP2P(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        BluetoothManager manager = activity.getSystemService(BluetoothManager.class);
        this.adapter = manager == null ? null : manager.getAdapter();
    }

    // ---------------------------------------------------------------- state ----
    boolean isSupported() {
        return adapter != null;
    }

    boolean isEnabled() {
        return adapter != null && adapter.isEnabled();
    }

    String[] missingPermissions() {
        List<String> missing = new ArrayList<>();
        if (adapter == null) return new String[0];
        String[] needed = Build.VERSION.SDK_INT >= 31
                ? new String[]{android.Manifest.permission.BLUETOOTH_CONNECT,
                               android.Manifest.permission.BLUETOOTH_SCAN,
                               android.Manifest.permission.BLUETOOTH_ADVERTISE}
                : new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION};
        for (String permission : needed) {
            if (activity.checkSelfPermission(permission) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                missing.add(permission);
            }
        }
        return missing.toArray(new String[0]);
    }

    String stateJson() {
        JSONObject state = new JSONObject();
        try {
            state.put("supported", isSupported());
            state.put("enabled", isEnabled());
            state.put("permissions", missingPermissions().length == 0);
            state.put("listening", acceptThread != null && acceptThread.isAlive());
            state.put("scanning", scanCallback != null || discoveryReceiver != null);
            state.put("listenError", listenError);
            state.put("shortId", shortId);
            JSONArray peers = new JSONArray();
            for (JSONObject peer : found.values()) peers.put(peer);
            state.put("peers", peers);
            JSONArray open = new JSONArray();
            for (Link link : links.values()) {
                JSONObject item = new JSONObject();
                item.put("address", link.address);
                item.put("socket", link.token);
                item.put("name", link.name);
                item.put("connected", link.connected);
                item.put("incoming", link.incoming);
                open.put(item);
            }
            state.put("links", open);
        } catch (JSONException ignored) { /* static keys only */ }
        return state.toString();
    }

    private void emit(JSONObject event) {
        listener.onEvent(event.toString());
    }

    private void emitError(String text) {
        JSONObject event = new JSONObject();
        try {
            event.put("type", "error");
            event.put("text", text);
        } catch (JSONException ignored) { /* static keys */ }
        emit(event);
    }

    void broadcastState() {
        JSONObject event;
        try {
            event = new JSONObject(stateJson());
            event.put("type", "state");
        } catch (JSONException ignored) { return; }
        emit(event);
    }

    // ------------------------------------------------------------- listening ---
    @SuppressLint("MissingPermission") // checked via missingPermissions() on the web side
    synchronized void startListening(String suffix) {
        if (!isEnabled() || acceptThread != null && acceptThread.isAlive()) return;
        shortId = suffix == null ? "" : suffix;
        listenError = "";
        acceptThread = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    serverSocket = adapter.listenUsingRfcommWithServiceRecord(
                            NAME_PREFIX + shortId, SERVICE_UUID);
                    broadcastState();
                    while (!Thread.currentThread().isInterrupted()) {
                        BluetoothSocket socket = serverSocket.accept();
                        link(socket, true);
                    }
                } catch (IOException error) {
                    if (!Thread.currentThread().isInterrupted()) {
                        listenError = error.getMessage() == null ? "accept failed" : error.getMessage();
                    }
                } finally {
                    broadcastState();
                }
            }
        }, "libo-bt-accept");
        acceptThread.start();
        startAdvertising();
    }

    synchronized void stopListening() {
        if (acceptThread != null) acceptThread.interrupt();
        acceptThread = null;
        closeQuietly(serverSocket);
        serverSocket = null;
        stopAdvertising();
        broadcastState();
    }

    @SuppressLint("MissingPermission")
    private void startAdvertising() {
        if (Build.VERSION.SDK_INT < 21 || adapter == null) return;
        BluetoothLeAdvertiser advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null || advertiseCallback != null) return;
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .build();
        AdvertiseData.Builder data = new AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addServiceUuid(new ParcelUuid(SERVICE_UUID));
        if (!shortId.isEmpty()) {
            data.addServiceData(new ParcelUuid(SERVICE_UUID),
                    shortId.getBytes(StandardCharsets.US_ASCII));
        }
        advertiseCallback = new AdvertiseCallback() {
            @Override public void onStartFailure(int errorCode) {
                advertiseCallback = null;
                emitError("BLE-реклама недоступна на цьому пристрої (" + errorCode + "). Працює класичний пошук.");
            }
        };
        try {
            advertiser.startAdvertising(settings, data.build(), advertiseCallback);
        } catch (SecurityException security) {
            advertiseCallback = null;
        }
    }

    private void stopAdvertising() {
        if (advertiseCallback == null || adapter == null) return;
        BluetoothLeAdvertiser advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser != null) {
            try { advertiser.stopAdvertising(advertiseCallback); } catch (SecurityException ignored) { }
        }
        advertiseCallback = null;
    }

    // ------------------------------------------------------------ discovery ----
    @SuppressLint("MissingPermission")
    synchronized void startDiscovery() {
        if (!isEnabled() || scanCallback != null || discoveryReceiver != null) return;
        found.clear();
        discoveryReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device != null) reportPeer(device.getAddress(), nameOf(device), 0, "");
                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(intent.getAction())) {
                    broadcastState();
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        activity.registerReceiver(discoveryReceiver, filter);
        try { adapter.startDiscovery(); } catch (SecurityException ignored) { }

        if (Build.VERSION.SDK_INT >= 21) {
            scanner = adapter.getBluetoothLeScanner();
            if (scanner != null) {
                scanCallback = new ScanCallback() {
                    @Override public void onScanResult(int callbackType, ScanResult result) {
                        BluetoothDevice device = result.getDevice();
                        String label = "";
                        if (result.getScanRecord() != null) {
                            byte[] service = result.getScanRecord().getServiceData(new ParcelUuid(SERVICE_UUID));
                            if (service != null) label = new String(service, StandardCharsets.US_ASCII);
                        }
                        reportPeer(device.getAddress(), nameOf(device), result.getRssi(), label);
                    }
                };
                ScanSettings settings = new ScanSettings.Builder()
                        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
                List<ScanFilter> filters = new ArrayList<>();
                filters.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE_UUID)).build());
                try { scanner.startScan(filters, settings, scanCallback); }
                catch (SecurityException security) { scanCallback = null; }
            }
        }
        broadcastState();
    }

    @SuppressLint("MissingPermission")
    synchronized void stopDiscovery() {
        if (discoveryReceiver != null) {
            try { activity.unregisterReceiver(discoveryReceiver); } catch (IllegalArgumentException ignored) { }
            discoveryReceiver = null;
        }
        try { adapter.cancelDiscovery(); } catch (SecurityException ignored) { }
        if (scanCallback != null && scanner != null) {
            try { scanner.stopScan(scanCallback); } catch (SecurityException ignored) { }
            scanCallback = null;
        }
        broadcastState();
    }

    private String nameOf(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null ? "" : name;
        } catch (SecurityException ignored) { return ""; }
    }

    private synchronized void reportPeer(String address, String name, int rssi, String shortId) {
        if (address == null) return;
        JSONObject peer = found.get(address);
        try {
            if (peer == null) {
                peer = new JSONObject();
                peer.put("address", address);
                found.put(address, peer);
            }
            peer.put("name", name);
            if (rssi != 0) peer.put("rssi", rssi);
            if (!shortId.isEmpty()) peer.put("shortId", shortId);
        } catch (JSONException ignored) { /* static keys */ }
        JSONObject event;
        try {
            event = new JSONObject(peer.toString());
            event.put("type", "peer");
        } catch (JSONException ignored) { return; }
        emit(event);
    }

    // -------------------------------------------------------------- connect ----
    @SuppressLint("MissingPermission")
    synchronized boolean hasLink(String address) {
        for (Link link : links.values()) if (link.address.equals(address)) return true;
        return false;
    }

    synchronized void connect(final String address) {
        if (!isEnabled() || address == null || hasLink(address)) return;
        final BluetoothDevice device = adapter.getRemoteDevice(address);
        Thread thread = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    try { adapter.cancelDiscovery(); } catch (SecurityException ignored) { }
                    BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SERVICE_UUID);
                    socket.connect();
                    link(socket, false);
                } catch (IOException | SecurityException | IllegalArgumentException error) {
                    JSONObject event = new JSONObject();
                    try {
                        event.put("type", "error");
                        event.put("text", "Не вдалося з'єднатися з " + address + ". Переконайтеся, що LIBO відкритий поруч і слухає з'єднання.");
                    } catch (JSONException ignored) { /* static keys */ }
                    emit(event);
                }
            }
        }, "libo-bt-connect");
        thread.start();
    }

    synchronized void disconnect(String address) {
        for (Link link : new ArrayList<>(links.values())) {
            if (link.address.equals(address)) link.close();
        }
        broadcastState();
    }

    synchronized void disconnectToken(int token) {
        Link link = links.get(token);
        if (link != null) link.close();
        broadcastState();
    }

    synchronized boolean send(String address, String payload) {
        Link target = null;
        for (Link link : links.values()) if (link.address.equals(address)) target = link;
        return target != null && target.send(payload);
    }

    synchronized boolean sendTo(int token, String payload) {
        Link link = links.get(token);
        return link != null && link.send(payload);
    }

    synchronized void stopAll() {
        stopDiscovery();
        stopListening();
        for (Link link : new ArrayList<>(links.values())) link.close();
        links.clear();
        broadcastState();
    }

    // ----------------------------------------------------------------- link ----
    private synchronized void link(BluetoothSocket socket, boolean incoming) {
        final Link link = new Link(socket, incoming, tokenSeq.getAndIncrement());
        links.put(link.token, link);
        JSONObject event = new JSONObject();
        try {
            event.put("type", "connected");
            event.put("address", link.address);
            event.put("socket", link.token);
            event.put("name", link.name);
            event.put("incoming", incoming);
        } catch (JSONException ignored) { /* static keys */ }
        emit(event);
        broadcastState();
        Thread reader = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    while (!Thread.currentThread().isInterrupted()) {
                        int length = link.input.readInt();
                        if (length <= 0 || length > MAX_FRAME) break;
                        byte[] frame = new byte[length];
                        link.input.readFully(frame);
                        JSONObject event = new JSONObject();
                        event.put("type", "data");
                        event.put("address", link.address);
                        event.put("socket", link.token);
                        event.put("text", new String(frame, StandardCharsets.UTF_8));
                        emit(event);
                    }
                } catch (Exception ignored) {
                    /* link closed or peer vanished */
                }
                synchronized (BluetoothP2P.this) {
                    links.remove(link.token);
                }
                link.close();
                JSONObject event = new JSONObject();
                try {
                    event.put("type", "disconnected");
                    event.put("address", link.address);
                    event.put("socket", link.token);
                } catch (JSONException ignored) { /* static keys */ }
                emit(event);
                broadcastState();
            }
        }, "libo-bt-read");
        link.thread = reader;
        reader.start();
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) return;
        try { closeable.close(); } catch (IOException ignored) { }
    }

    private final class Link {
        final String address;
        final String name;
        final boolean incoming;
        final int token;
        final DataInputStream input;
        final DataOutputStream output;
        final BluetoothSocket socket;
        Thread thread;
        volatile boolean connected = true;

        Link(BluetoothSocket socket, boolean incoming, int token) {
            this.token = token;
            this.socket = socket;
            this.address = socket.getRemoteDevice().getAddress();
            String remote = nameOf(socket.getRemoteDevice());
            this.name = remote == null || remote.isEmpty() ? NAME_PREFIX + address.substring(12) : remote;
            this.incoming = incoming;
            DataInputStream in = null;
            DataOutputStream out = null;
            try {
                in = new DataInputStream(socket.getInputStream());
                out = new DataOutputStream(socket.getOutputStream());
            } catch (IOException error) {
                connected = false;
            }
            this.input = in;
            this.output = out;
        }

        synchronized boolean send(String payload) {
            if (!connected || output == null) return false;
            byte[] frame = payload.getBytes(StandardCharsets.UTF_8);
            if (frame.length > MAX_FRAME) return false;
            try {
                output.writeInt(frame.length);
                output.write(frame);
                output.flush();
                return true;
            } catch (IOException error) {
                close();
                return false;
            }
        }

        synchronized void close() {
            connected = false;
            if (thread != null) thread.interrupt();
            closeQuietly(socket);
        }
    }
}
