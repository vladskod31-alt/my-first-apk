package app.libo.messenger;

import android.app.Activity;
import android.nfc.*;
import android.nfc.tech.Ndef;
import java.nio.charset.StandardCharsets;

/** Explicit read/write of NDEF tags, NOT removed Android Beam phone-to-phone APIs. */
final class NfcInvites implements NfcAdapter.ReaderCallback {
    interface Sink { void emit(String value, boolean error); }
    final Activity activity; final Sink sink; final NfcAdapter adapter;
    volatile String pending; volatile boolean armed;
    NfcInvites(Activity a, Sink s){activity=a;sink=s;adapter=NfcAdapter.getDefaultAdapter(a);}
    boolean available(){return adapter!=null && adapter.isEnabled();}
    void start(String invite){
        if(!available()){sink.emit("NFC недоступний або вимкнений",true);return;}
        if(invite!=null && (invite.length()>4096 || !invite.startsWith("LIBO:"))){sink.emit("Неправильне запрошення",true);return;}
        pending=invite;armed=true;
        adapter.enableReaderMode(activity,this,NfcAdapter.FLAG_READER_NFC_A|NfcAdapter.FLAG_READER_NFC_B|NfcAdapter.FLAG_READER_NFC_F|NfcAdapter.FLAG_READER_NFC_V,null);
        sink.emit("Прикладіть NDEF-мітку",true);
    }
    public void onTagDiscovered(Tag tag){
        if(!armed)return;
        Ndef ndef=Ndef.get(tag);
        if(ndef==null){sink.emit("Потрібна попередньо форматована NDEF-мітка",true);return;}
        try{
            ndef.connect();String value=pending;
            if(value!=null){
                NdefMessage message=new NdefMessage(new NdefRecord[]{NdefRecord.createMime("application/vnd.libo.invite",value.getBytes(StandardCharsets.UTF_8))});
                if(!ndef.isWritable()||ndef.getMaxSize()<message.toByteArray().length)throw new Exception("Мітка захищена або замала");
                ndef.writeNdefMessage(message);sink.emit("Запрошення записано на NFC-мітку",true);
            }else{
                NdefMessage message=ndef.getNdefMessage();boolean found=false;
                if(message!=null)for(NdefRecord r:message.getRecords()){
                    if(r.getTnf()==NdefRecord.TNF_MIME_MEDIA && "application/vnd.libo.invite".equals(new String(r.getType(),StandardCharsets.US_ASCII)) && r.getPayload().length<=4096){
                        value=new String(r.getPayload(),StandardCharsets.UTF_8);
                        if(value.startsWith("LIBO:")){sink.emit(value,false);found=true;break;}
                    }
                }
                if(!found)throw new Exception("Запрошення LIBO не знайдено");
            }
            armed=false;pending=null;activity.runOnUiThread(() -> stop());
        }catch(Exception e){sink.emit(e.getMessage()==null?"Не вдалося прочитати NFC":e.getMessage(),true);}
        finally{try{ndef.close();}catch(Exception ignored){}}
    }
    void stop(){armed=false;pending=null;if(adapter!=null)adapter.disableReaderMode(activity);}
}
