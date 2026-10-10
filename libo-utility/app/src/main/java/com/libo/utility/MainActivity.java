package com.libo.utility;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.ThumbnailUtils;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public class MainActivity extends Activity {

    private static final int REQ_PICK_MEDIA = 1;
    private static final int REQ_EXPORT_CSV = 2;

    private static final int COLOR_BG = 0xFF0F0C29;
    private static final int COLOR_CARD = 0xFF1E1B3A;
    private static final int COLOR_ACTIVE = 0xFF5B3FD0;
    private static final int COLOR_ACCENT = 0xFF00FFFF;
    private static final int COLOR_TEXT = 0xFFFFFFFF;
    private static final int COLOR_MUTED = 0xFFAAAAAA;

    private Db db;
    private int tab = 0; // 0 = contacts, 1 = media

    private Button tabContacts;
    private Button tabMedia;
    private Button btnAdd;
    private Button btnExport;
    private EditText search;
    private ListView contactList;
    private GridView mediaGrid;
    private TextView empty;

    private final List<Contact> contacts = new ArrayList<>();
    private final List<Contact> shownContacts = new ArrayList<>();
    private final List<MediaItem> media = new ArrayList<>();
    private ArrayAdapter<String> contactAdapter;
    private MediaAdapter mediaAdapter;
    private final LruCache<Long, Bitmap> thumbCache = new LruCache<>(60);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        db = new Db(this);
        buildUi();
        loadAll();
        showTab(0);
    }

    // ---------- UI construction ----------

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(COLOR_BG);
        int pad = dp(12);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("LIBO Утиліта");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(COLOR_ACCENT);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Номери, імена, фото та відео — окремо від LIBO");
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        subtitle.setTextColor(COLOR_MUTED);
        subtitle.setPadding(0, 0, 0, dp(8));
        root.addView(subtitle);

        // Tabs
        LinearLayout tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabContacts = makeButton("Контакти");
        tabMedia = makeButton("Фото / відео");
        tabContacts.setOnClickListener(v -> showTab(0));
        tabMedia.setOnClickListener(v -> showTab(1));
        tabs.addView(tabContacts, weightParams());
        tabs.addView(tabMedia, weightParams());
        root.addView(tabs);

        // Toolbar
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(0, dp(8), 0, dp(8));

        search = new EditText(this);
        search.setHint("Пошук за ім'ям або номером");
        search.setHintTextColor(COLOR_MUTED);
        search.setTextColor(COLOR_TEXT);
        search.setSingleLine(true);
        search.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                refreshContacts();
            }

            @Override
            public void afterTextChanged(Editable s) {
            }
        });
        toolbar.addView(search, weightParams());

        btnAdd = makeButton("+ Контакт");
        btnAdd.setOnClickListener(v -> onAddClicked());
        toolbar.addView(btnAdd);

        btnExport = makeButton("CSV");
        btnExport.setOnClickListener(v -> startCsvExport());
        toolbar.addView(btnExport);
        root.addView(toolbar);

        // Content
        FrameLayout content = new FrameLayout(this);

        contactAdapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1,
                android.R.id.text1, new ArrayList<String>());
        contactList = new ListView(this);
        contactList.setAdapter(contactAdapter);
        contactList.setDividerHeight(dp(1));
        contactList.setOnItemClickListener((parent, view, position, id) ->
                showContactActions(shownContacts.get(position)));
        content.addView(contactList, matchParent());

        mediaAdapter = new MediaAdapter();
        mediaGrid = new GridView(this);
        mediaGrid.setNumColumns(3);
        mediaGrid.setVerticalSpacing(dp(6));
        mediaGrid.setHorizontalSpacing(dp(6));
        mediaGrid.setPadding(dp(2), dp(2), dp(2), dp(2));
        mediaGrid.setAdapter(mediaAdapter);
        mediaGrid.setOnItemClickListener((parent, view, position, id) ->
                openMedia(media.get(position)));
        mediaGrid.setOnItemLongClickListener((parent, view, position, id) -> {
            confirmDeleteMedia(media.get(position));
            return true;
        });
        content.addView(mediaGrid, matchParent());

        empty = new TextView(this);
        empty.setTextColor(COLOR_MUTED);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(dp(24), dp(24), dp(24), dp(24));
        FrameLayout.LayoutParams emptyParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        content.addView(empty, emptyParams);

        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
    }

    private void showTab(int newTab) {
        tab = newTab;
        boolean contactsTab = tab == 0;
        contactList.setVisibility(contactsTab ? View.VISIBLE : View.GONE);
        mediaGrid.setVisibility(contactsTab ? View.GONE : View.VISIBLE);
        search.setVisibility(contactsTab ? View.VISIBLE : View.GONE);
        btnExport.setVisibility(contactsTab ? View.VISIBLE : View.GONE);
        btnAdd.setText(contactsTab ? "+ Контакт" : "+ Файли");
        styleTab(tabContacts, contactsTab);
        styleTab(tabMedia, !contactsTab);
        updateEmpty();
    }

    private void styleTab(Button b, boolean active) {
        b.setBackgroundColor(active ? COLOR_ACTIVE : COLOR_CARD);
        b.setTextColor(active ? COLOR_TEXT : COLOR_MUTED);
    }

    private Button makeButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setTextColor(COLOR_TEXT);
        b.setBackgroundColor(COLOR_CARD);
        b.setMinHeight(dp(44));
        b.setMinimumHeight(dp(44));
        b.setPadding(dp(10), 0, dp(10), 0);
        return b;
    }

    private LinearLayout.LayoutParams weightParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        p.setMargins(dp(2), 0, dp(2), 0);
        return p;
    }

    private FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value,
                getResources().getDisplayMetrics());
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    // ---------- Data refresh ----------

    private void loadAll() {
        contacts.clear();
        contacts.addAll(db.getContacts());
        media.clear();
        media.addAll(db.getMedia());
        refreshContacts();
        mediaAdapter.notifyDataSetChanged();
        updateEmpty();
    }

    private void refreshContacts() {
        String q = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        shownContacts.clear();
        List<String> texts = new ArrayList<>();
        for (Contact c : contacts) {
            boolean match = q.isEmpty()
                    || c.name.toLowerCase(Locale.ROOT).contains(q)
                    || c.phone.toLowerCase(Locale.ROOT).contains(q)
                    || c.note.toLowerCase(Locale.ROOT).contains(q);
            if (match) {
                shownContacts.add(c);
                String line = c.name;
                if (!c.phone.isEmpty()) line += "\n📞 " + c.phone;
                if (!c.note.isEmpty()) line += "\n📝 " + c.note;
                texts.add(line);
            }
        }
        contactAdapter.clear();
        contactAdapter.addAll(texts);
        contactAdapter.notifyDataSetChanged();
        updateEmpty();
    }

    private void updateEmpty() {
        if (tab == 0) {
            empty.setVisibility(shownContacts.isEmpty() ? View.VISIBLE : View.GONE);
            empty.setText(contacts.isEmpty()
                    ? "Ще немає контактів.\nНатисніть «+ Контакт», щоб додати номер або ім'я."
                    : "Нічого не знайдено");
        } else {
            empty.setVisibility(media.isEmpty() ? View.VISIBLE : View.GONE);
            empty.setText("Ще немає фото чи відео.\nНатисніть «+ Файли», щоб додати їх.");
        }
    }

    // ---------- Contacts ----------

    private void onAddClicked() {
        if (tab == 0) {
            showContactDialog(null);
        } else {
            pickMedia();
        }
    }

    private void showContactDialog(final Contact existing) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        int p = dp(16);
        form.setPadding(p, dp(8), p, 0);

        final EditText etName = input("Ім'я", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_CAP_WORDS);
        final EditText etPhone = input("Номер телефону", InputType.TYPE_CLASS_PHONE);
        final EditText etNote = input("Нотатка (необов'язково)",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        if (existing != null) {
            etName.setText(existing.name);
            etPhone.setText(existing.phone);
            etNote.setText(existing.note);
        }
        form.addView(etName);
        form.addView(etPhone);
        form.addView(etNote);

        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(existing == null ? "Новий контакт" : "Редагувати контакт")
                .setView(form)
                .setPositiveButton("Зберегти", null)
                .setNegativeButton("Скасувати", null)
                .create();
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String name = etName.getText().toString().trim();
            if (name.isEmpty()) {
                etName.setError("Введіть ім'я");
                return;
            }
            Contact c = existing != null ? existing : new Contact();
            c.name = name;
            c.phone = etPhone.getText().toString().trim();
            c.note = etNote.getText().toString().trim();
            if (existing == null) {
                c.created = System.currentTimeMillis();
                db.insertContact(c);
            } else {
                db.updateContact(c);
            }
            dialog.dismiss();
            loadAll();
            toast("Збережено");
        });
    }

    private EditText input(String hint, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setInputType(type);
        e.setTextColor(COLOR_TEXT);
        e.setHintTextColor(COLOR_MUTED);
        return e;
    }

    private void showContactActions(final Contact c) {
        String[] items = {"Зателефонувати", "Копіювати номер", "Редагувати", "Видалити"};
        new AlertDialog.Builder(this)
                .setTitle(c.name)
                .setItems(items, (dialog, which) -> {
                    switch (which) {
                        case 0:
                            if (c.phone.isEmpty()) {
                                toast("Номер не вказано");
                            } else {
                                startActivity(new Intent(Intent.ACTION_DIAL,
                                        Uri.parse("tel:" + c.phone)));
                            }
                            break;
                        case 1:
                            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                            if (cm != null) {
                                cm.setPrimaryClip(ClipData.newPlainText("phone", c.phone));
                                toast("Номер скопійовано");
                            }
                            break;
                        case 2:
                            showContactDialog(c);
                            break;
                        case 3:
                            confirmDeleteContact(c);
                            break;
                        default:
                            break;
                    }
                })
                .show();
    }

    private void confirmDeleteContact(final Contact c) {
        new AlertDialog.Builder(this)
                .setTitle("Видалити контакт?")
                .setMessage(c.name)
                .setPositiveButton("Видалити", (d, w) -> {
                    db.deleteContact(c.id);
                    loadAll();
                    toast("Видалено");
                })
                .setNegativeButton("Скасувати", null)
                .show();
    }

    // ---------- CSV export ----------

    private void startCsvExport() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/csv");
        intent.putExtra(Intent.EXTRA_TITLE, "libo_contacts.csv");
        startActivityForResult(intent, REQ_EXPORT_CSV);
    }

    private void exportCsv(final Uri uri) {
        new Thread(() -> {
            try {
                List<Contact> all = db.getContacts();
                StringBuilder sb = new StringBuilder();
                sb.append('\uFEFF'); // BOM so Excel shows Ukrainian letters correctly
                sb.append("Ім'я,Телефон,Нотатка\r\n");
                for (Contact c : all) {
                    sb.append(csv(c.name)).append(',')
                            .append(csv(c.phone)).append(',')
                            .append(csv(c.note)).append("\r\n");
                }
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new IllegalStateException("No output stream");
                    os.write(sb.toString().getBytes(StandardCharsets.UTF_8));
                }
                final int count = all.size();
                runOnUiThread(() -> toast("Експортовано контактів: " + count));
            } catch (Exception e) {
                runOnUiThread(() -> toast("Помилка експорту: " + e.getMessage()));
            }
        }).start();
    }

    private static String csv(String s) {
        return "\"" + (s == null ? "" : s).replace("\"", "\"\"") + "\"";
    }

    // ---------- Media ----------

    private void pickMedia() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(intent, REQ_PICK_MEDIA);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null) return;

        if (requestCode == REQ_PICK_MEDIA) {
            List<Uri> uris = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    uris.add(clip.getItemAt(i).getUri());
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
            importMedia(uris);
        } else if (requestCode == REQ_EXPORT_CSV && data.getData() != null) {
            exportCsv(data.getData());
        }
    }

    private void importMedia(final List<Uri> uris) {
        toast("Копіюю файли…");
        new Thread(() -> {
            int ok = 0;
            for (Uri uri : uris) {
                try {
                    MediaItem item = copyToPrivate(uri);
                    if (item != null) {
                        db.insertMedia(item);
                        ok++;
                    }
                } catch (Exception ignored) {
                    // Skip files that cannot be read
                }
            }
            final int added = ok;
            runOnUiThread(() -> {
                loadAll();
                toast("Додано файлів: " + added);
            });
        }).start();
    }

    private MediaItem copyToPrivate(Uri uri) throws Exception {
        String mime = getContentResolver().getType(uri);
        String displayName = queryDisplayName(uri);
        if (displayName == null || displayName.isEmpty()) displayName = "file";

        String ext = "";
        int dot = displayName.lastIndexOf('.');
        if (dot >= 0) ext = displayName.substring(dot).toLowerCase(Locale.ROOT);

        boolean video = (mime != null && mime.startsWith("video/"))
                || ext.equals(".mp4") || ext.equals(".mkv") || ext.equals(".3gp")
                || ext.equals(".webm") || ext.equals(".mov");

        File dir = mediaDir();
        String stored = System.currentTimeMillis() + "_"
                + UUID.randomUUID().toString().substring(0, 8) + ext;
        File out = new File(dir, stored);

        try (InputStream in = getContentResolver().openInputStream(uri);
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                os.write(buf, 0, n);
            }
        }

        MediaItem item = new MediaItem();
        item.file = stored;
        item.name = displayName;
        item.video = video;
        item.created = System.currentTimeMillis();
        return item;
    }

    private String queryDisplayName(Uri uri) {
        Cursor c = getContentResolver().query(uri, null, null, null, null);
        if (c == null) return null;
        try {
            if (c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return c.getString(idx);
            }
        } finally {
            c.close();
        }
        return null;
    }

    private File mediaDir() {
        File dir = new File(getFilesDir(), "media");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    private File fileOf(MediaItem item) {
        return new File(mediaDir(), item.file);
    }

    private void openMedia(MediaItem item) {
        Intent i = new Intent(this, MediaViewerActivity.class);
        i.putExtra(MediaViewerActivity.EXTRA_PATH, fileOf(item).getAbsolutePath());
        i.putExtra(MediaViewerActivity.EXTRA_NAME, item.name);
        i.putExtra(MediaViewerActivity.EXTRA_VIDEO, item.video);
        startActivity(i);
    }

    private void confirmDeleteMedia(final MediaItem item) {
        new AlertDialog.Builder(this)
                .setTitle("Видалити файл?")
                .setMessage(item.name)
                .setPositiveButton("Видалити", (d, w) -> {
                    //noinspection ResultOfMethodCallIgnored
                    fileOf(item).delete();
                    db.deleteMedia(item.id);
                    thumbCache.remove(item.id);
                    loadAll();
                    toast("Видалено");
                })
                .setNegativeButton("Скасувати", null)
                .show();
    }

    private Bitmap thumbnailFor(MediaItem item) {
        Bitmap cached = thumbCache.get(item.id);
        if (cached != null) return cached;
        String path = fileOf(item).getAbsolutePath();
        Bitmap b;
        if (item.video) {
            b = ThumbnailUtils.createVideoThumbnail(path, MediaStore.Video.Thumbnails.MINI_KIND);
        } else {
            b = Util.decodeSampled(path, 320);
        }
        if (b != null) thumbCache.put(item.id, b);
        return b;
    }

    /** Grid adapter showing a thumbnail and a name for every saved photo or video. */
    private class MediaAdapter extends BaseAdapter {
        @Override
        public int getCount() {
            return media.size();
        }

        @Override
        public Object getItem(int position) {
            return media.get(position);
        }

        @Override
        public long getItemId(int position) {
            return media.get(position).id;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            MediaItem item = media.get(position);

            LinearLayout cell = new LinearLayout(MainActivity.this);
            cell.setOrientation(LinearLayout.VERTICAL);
            cell.setBackgroundColor(COLOR_CARD);

            ImageView thumb = new ImageView(MainActivity.this);
            thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
            thumb.setLayoutParams(new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(110)));
            Bitmap b = thumbnailFor(item);
            if (b != null) {
                thumb.setImageBitmap(b);
            } else {
                thumb.setImageResource(item.video
                        ? android.R.drawable.ic_media_play
                        : android.R.drawable.ic_menu_report_image);
            }
            cell.addView(thumb);

            TextView name = new TextView(MainActivity.this);
            name.setText((item.video ? "🎬 " : "🖼 ") + item.name);
            name.setTextColor(COLOR_TEXT);
            name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            name.setMaxLines(1);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            name.setPadding(dp(4), dp(3), dp(4), dp(4));
            cell.addView(name);
            return cell;
        }
    }
}
