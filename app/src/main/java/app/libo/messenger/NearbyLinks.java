package app.libo.messenger;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.wifi.p2p.*;
import android.os.Build;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Opt-in local TCP transport. Application frames are authenticated/encrypted by
 * Transport; an address and the public preamble are NOT proof of identity. */
final class NearbyLinks {
    interface Sink { void emit(JSONObject event); }
    static final int PERMISSION = 240, PORT = 42888, MAX = 2 * 1024 * 1024;
    final Activity activity; final Sink sink;
    final Map<Integer, Link> links = new ConcurrentHashMap<>();
    final Set<Socket> pending = Collections.newSetFromMap(new ConcurrentHashMap<Socket, Boolean>());
    final AtomicInteger ids = new AtomicInteger();
    final WifiP2pManager manager; final WifiP2pManager.Channel channel;
    BroadcastReceiver receiver;
    volatile ServerSocket server; volatile String myId; volatile boolean active;
    volatile String directHost;
    NearbyLinks(Activity a, Sink s) {
        activity = a; sink = s;
        manager = (WifiP2pManager)a.getSystemService(Context.WIFI_P2P_SERVICE);
        channel = manager == null ? null : manager.initialize(a, a.getMainLooper(), null);
    }
    void event(String kind, String key, Object value) {
        try { sink.emit(new JSONObject().put("ev", kind).put(key, value)); } catch (JSONException ignored) { }
    }
    void error(String message) { event("error", "message", message); }
    synchronized boolean start(String id) {
        if (!id.matches("libo-[a-f0-9]{32}")) return false;
        myId = id;
        if (active) return true;
        try {
            server = new ServerSocket(); server.setReuseAddress(true); server.bind(new InetSocketAddress(PORT)); active = true;
            final ServerSocket listener = server;
            new Thread(() -> {
                while (active && server == listener) {
                    try { Socket socket = listener.accept(); attach(socket, true); }
                    catch (IOException e) { break; }
                }
            }, "libo-lan-listen").start();
            return true;
        } catch (IOException e) { error("Не вдалося відкрити локальний порт"); return false; }
    }
    // Restrict the native bridge to private IPv4 LAN addresses (no arbitrary host/URL).
    static boolean localAddress(String host) {
        if (host == null || !host.matches("[0-9.]{7,15}")) return false;
        String[] p = host.split("\\."); if (p.length != 4) return false;
        int[] n = new int[4];
        try { for (int i=0;i<4;i++) { n[i]=Integer.parseInt(p[i]); if(n[i]<0||n[i]>255)return false; } } catch(Exception e){return false;}
        return n[0]==10 || (n[0]==192 && n[1]==168) || (n[0]==172 && n[1]>=16 && n[1]<=31);
    }
    void connect(String host) {
        if (!active || !localAddress(host)) { error("Спочатку увімкніть локальний канал і введіть приватну IPv4-адресу"); return; }
        synchronized(this) { if (links.size()+pending.size()>=6) { error("Забагато каналів"); return; } }
        final Socket socket = new Socket(); pending.add(socket);
        new Thread(() -> {
            try { socket.connect(new InetSocketAddress(host, PORT), 8000); pending.remove(socket); attach(socket, false); }
            catch(IOException e) { pending.remove(socket); try{socket.close();}catch(IOException ignored){} error("Телефон недоступний. Перевірте Wi-Fi і локальний канал на обох пристроях"); }
        }, "libo-lan-connect").start();
    }
    synchronized void attach(Socket socket, boolean incoming) {
        if (!active || links.size()+pending.size()>=6) { try{socket.close();}catch(IOException ignored){} return; }
        pending.add(socket);
        new Thread(() -> {
            Link link = null;
            try {
                socket.setSoTimeout(10000); socket.setTcpNoDelay(true);
                DataInputStream in = new DataInputStream(new BufferedInputStream(socket.getInputStream()));
                DataOutputStream out = new DataOutputStream(new BufferedOutputStream(socket.getOutputStream()));
                write(out, "LIBO1 " + myId);
                String hello = read(in, 64);
                if (!hello.matches("LIBO1 libo-[a-f0-9]{32}") || hello.substring(6).equals(myId)) throw new IOException();
                if (!active) throw new IOException();
                int id = ids.incrementAndGet(); link = new Link(id, socket, out);
                links.put(id, link); pending.remove(socket); socket.setSoTimeout(0);
                sink.emit(new JSONObject().put("ev","open").put("link",id).put("peer",hello.substring(6))
                    .put("incoming",incoming).put("name","Wi-Fi").put("address",socket.getInetAddress().getHostAddress()));
                while(active && !socket.isClosed()) {
                    String json = read(in, MAX);
                    sink.emit(new JSONObject().put("ev","data").put("link",id).put("json",json));
                }
            } catch(Exception ignored) { }
            finally { pending.remove(socket); if(link!=null)close(link.id); else try{socket.close();}catch(IOException ignored){} }
        }, "libo-lan-read").start();
    }
    static String read(DataInputStream in, int max) throws IOException {
        int size = in.readInt(); if(size<1||size>max)throw new IOException("frame size");
        byte[] bytes=new byte[size]; in.readFully(bytes); return new String(bytes,StandardCharsets.UTF_8);
    }
    static void write(DataOutputStream out, String value) throws IOException {
        byte[] bytes=value.getBytes(StandardCharsets.UTF_8); if(bytes.length>MAX)throw new IOException("frame size");
        out.writeInt(bytes.length);out.write(bytes);out.flush();
    }
    boolean send(int id,String json) {
        Link link=links.get(id); if(link==null||json.length()>MAX)return false;
        try { link.writer.execute(() -> { try{write(link.out,json);}catch(IOException e){close(id);} }); return true; }
        catch(RejectedExecutionException e){close(id);return false;}
    }
    void close(int id) {
        Link link=links.remove(id); if(link==null)return;
        link.writer.shutdownNow(); try{link.socket.close();}catch(IOException ignored){}
        event("close","link",id);
    }
    String status() {
        JSONObject data=new JSONObject();JSONArray addresses=new JSONArray();
        try {
            Enumeration<NetworkInterface> all=NetworkInterface.getNetworkInterfaces();
            while(all!=null&&all.hasMoreElements()) {
                Enumeration<InetAddress> ips=all.nextElement().getInetAddresses();
                while(ips.hasMoreElements()){String ip=ips.nextElement().getHostAddress();if(localAddress(ip))addresses.put(ip);}
            }
            data.put("addresses",addresses).put("listening",active).put("direct",channel!=null);
        }catch(Exception ignored){}
        return data.toString();
    }
    String[] permissions(){return Build.VERSION.SDK_INT>=33 ? new String[]{Manifest.permission.NEARBY_WIFI_DEVICES} : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};}
    boolean permitted(){for(String p:permissions())if(activity.checkSelfPermission(p)!=PackageManager.PERMISSION_GRANTED)return false;return true;}
    final WifiP2pManager.ActionListener result = new WifiP2pManager.ActionListener(){
        public void onSuccess(){event("status","message","Запит Wi-Fi Direct надіслано");}
        public void onFailure(int reason){error("Wi-Fi Direct: код " + reason + ". Увімкніть Wi-Fi; на Android 12 і нижче також геолокацію");}
    };
    void scan() {
        if(!active){error("Спочатку увімкніть локальний канал");return;}
        if(channel==null){error("Wi-Fi Direct не підтримується");return;}
        if(!permitted()){activity.requestPermissions(permissions(),PERMISSION);return;}
        if(receiver==null){
            receiver=new BroadcastReceiver(){public void onReceive(Context c,Intent intent){
                if(!active||!permitted())return;
                try {
                    if(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION.equals(intent.getAction())) manager.requestPeers(channel, list -> {
                        JSONArray devices=new JSONArray();
                        for(WifiP2pDevice d:list.getDeviceList())try{devices.put(new JSONObject().put("address",d.deviceAddress).put("name",d.deviceName));}catch(JSONException ignored){}
                        event("devices","devices",devices);
                    });
                    if(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION.equals(intent.getAction())) manager.requestConnectionInfo(channel, info -> {
                        if(info.groupFormed && !info.isGroupOwner && info.groupOwnerAddress!=null){
                            String host=info.groupOwnerAddress.getHostAddress();
                            if(!host.equals(directHost)){directHost=host;connect(host);}
                        } else if(!info.groupFormed)directHost=null;
                    });
                }catch(SecurityException e){error("Немає дозволу Wi-Fi Direct");}
            }};
            IntentFilter filter=new IntentFilter();filter.addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION);filter.addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION);
            if(Build.VERSION.SDK_INT>=33)activity.registerReceiver(receiver,filter,Context.RECEIVER_EXPORTED);else activity.registerReceiver(receiver,filter);
        }
        try{manager.discoverPeers(channel,result);}catch(SecurityException e){error("Немає дозволу Wi-Fi Direct");}
    }
    void direct(String address){
        if(!active||channel==null||!permitted()||!address.matches("(?i)([0-9a-f]{2}:){5}[0-9a-f]{2}"))return;
        WifiP2pConfig config=new WifiP2pConfig();config.deviceAddress=address;
        try{manager.connect(channel,config,result);}catch(SecurityException e){error("Немає дозволу Wi-Fi Direct");}
    }
    synchronized void stop(){
        active=false; directHost=null;
        try{if(server!=null)server.close();}catch(IOException ignored){}server=null;
        for(Socket socket:pending)try{socket.close();}catch(IOException ignored){}pending.clear();
        for(Integer id:new ArrayList<>(links.keySet()))close(id);
        if(receiver!=null){activity.unregisterReceiver(receiver);receiver=null;}
        if(channel!=null&&permitted())try{manager.stopPeerDiscovery(channel,null);manager.removeGroup(channel,null);}catch(SecurityException ignored){}
    }
    void destroy(){stop();if(channel!=null && Build.VERSION.SDK_INT>=27)channel.close();}
    static final class Link {
        final int id;final Socket socket;final DataOutputStream out;
        final ThreadPoolExecutor writer=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(32));
        Link(int i,Socket s,DataOutputStream o){id=i;socket=s;out=o;}
    }
}
