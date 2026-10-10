package com.libo.utility;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.MediaController;
import android.widget.TextView;
import android.widget.VideoView;

import java.io.File;

/** Full-screen viewer for a single saved photo or video. */
public class MediaViewerActivity extends Activity {

    public static final String EXTRA_PATH = "path";
    public static final String EXTRA_NAME = "name";
    public static final String EXTRA_VIDEO = "video";

    private VideoView videoView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String path = getIntent().getStringExtra(EXTRA_PATH);
        String name = getIntent().getStringExtra(EXTRA_NAME);
        boolean video = getIntent().getBooleanExtra(EXTRA_VIDEO, false);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        if (path == null || !new File(path).exists()) {
            TextView err = new TextView(this);
            err.setText("Файл не знайдено");
            err.setTextColor(Color.WHITE);
            err.setGravity(Gravity.CENTER);
            root.addView(err, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        } else if (video) {
            videoView = new VideoView(this);
            MediaController controller = new MediaController(this);
            videoView.setMediaController(controller);
            videoView.setVideoURI(Uri.fromFile(new File(path)));
            videoView.setOnPreparedListener(mp -> videoView.start());
            root.addView(videoView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
                    Gravity.CENTER));
        } else {
            ImageView iv = new ImageView(this);
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
            Bitmap b = Util.decodeSampled(path, 2048);
            if (b != null) iv.setImageBitmap(b);
            root.addView(iv, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        TextView title = new TextView(this);
        title.setText(name != null ? name : "");
        title.setTextColor(Color.WHITE);
        title.setBackgroundColor(0x88000000);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        int p = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 10,
                getResources().getDisplayMetrics());
        title.setPadding(p, p, p, p);
        title.setMaxLines(1);
        root.addView(title, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP));

        setContentView(root);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (videoView != null && videoView.isPlaying()) videoView.pause();
    }
}
