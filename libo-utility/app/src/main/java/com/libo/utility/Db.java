package com.libo.utility;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/** Local SQLite storage for contacts and media metadata. */
public class Db extends SQLiteOpenHelper {

    private static final String DB_NAME = "libo_utility.db";
    private static final int DB_VERSION = 1;

    public Db(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE contacts ("
                + "_id INTEGER PRIMARY KEY AUTOINCREMENT, "
                + "name TEXT NOT NULL, "
                + "phone TEXT, "
                + "note TEXT, "
                + "created INTEGER)");
        db.execSQL("CREATE TABLE media ("
                + "_id INTEGER PRIMARY KEY AUTOINCREMENT, "
                + "file TEXT NOT NULL, "
                + "name TEXT, "
                + "is_video INTEGER, "
                + "created INTEGER)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Version 1 is the first schema; nothing to migrate yet.
    }

    // ---------- Contacts ----------

    public List<Contact> getContacts() {
        List<Contact> list = new ArrayList<>();
        Cursor c = getReadableDatabase().query("contacts", null, null, null, null, null,
                "name COLLATE NOCASE ASC");
        try {
            while (c.moveToNext()) {
                Contact item = new Contact();
                item.id = c.getLong(c.getColumnIndexOrThrow("_id"));
                item.name = nullToEmpty(c.getString(c.getColumnIndexOrThrow("name")));
                item.phone = nullToEmpty(c.getString(c.getColumnIndexOrThrow("phone")));
                item.note = nullToEmpty(c.getString(c.getColumnIndexOrThrow("note")));
                item.created = c.getLong(c.getColumnIndexOrThrow("created"));
                list.add(item);
            }
        } finally {
            c.close();
        }
        return list;
    }

    public void insertContact(Contact item) {
        ContentValues cv = new ContentValues();
        cv.put("name", item.name);
        cv.put("phone", item.phone);
        cv.put("note", item.note);
        cv.put("created", item.created);
        item.id = getWritableDatabase().insert("contacts", null, cv);
    }

    public void updateContact(Contact item) {
        ContentValues cv = new ContentValues();
        cv.put("name", item.name);
        cv.put("phone", item.phone);
        cv.put("note", item.note);
        getWritableDatabase().update("contacts", cv, "_id=?",
                new String[]{String.valueOf(item.id)});
    }

    public void deleteContact(long id) {
        getWritableDatabase().delete("contacts", "_id=?", new String[]{String.valueOf(id)});
    }

    // ---------- Media ----------

    public List<MediaItem> getMedia() {
        List<MediaItem> list = new ArrayList<>();
        Cursor c = getReadableDatabase().query("media", null, null, null, null, null,
                "created DESC");
        try {
            while (c.moveToNext()) {
                MediaItem item = new MediaItem();
                item.id = c.getLong(c.getColumnIndexOrThrow("_id"));
                item.file = nullToEmpty(c.getString(c.getColumnIndexOrThrow("file")));
                item.name = nullToEmpty(c.getString(c.getColumnIndexOrThrow("name")));
                item.video = c.getInt(c.getColumnIndexOrThrow("is_video")) == 1;
                item.created = c.getLong(c.getColumnIndexOrThrow("created"));
                list.add(item);
            }
        } finally {
            c.close();
        }
        return list;
    }

    public void insertMedia(MediaItem item) {
        ContentValues cv = new ContentValues();
        cv.put("file", item.file);
        cv.put("name", item.name);
        cv.put("is_video", item.video ? 1 : 0);
        cv.put("created", item.created);
        item.id = getWritableDatabase().insert("media", null, cv);
    }

    public void deleteMedia(long id) {
        getWritableDatabase().delete("media", "_id=?", new String[]{String.valueOf(id)});
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
