package app.libo.messenger;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.os.SystemClock;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;

/**
 * Animated launch overlay shown above the WebView until the messenger signals
 * {@code LiboAndroid.uiReady()} (or a 4 s watchdog fires). It guarantees a branded
 * first frame on every device: 2.8.1 briefly showed the transparent WebView over an
 * empty window, which several launchers rendered as a black screen.
 *
 * The animation is flat 2D on purpose: three expanding signal rings, the logo scaling
 * in with a slight overshoot and a diagonal light sweep, all in the brand palette.
 */
public final class SplashView extends View {
    private static final long RING_PERIOD = 1500L;
    private static final long LOGO_IN = 520L;
    private static final long FADE_OUT = 420L;
    private static final long WATCHDOG = 4000L;

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Drawable logo;
    private final int field;
    private final int ring;
    private final long startedAt = SystemClock.uptimeMillis();
    private long finishAt = -1L;
    private boolean removed;
    private Runnable onGone;

    public SplashView(Context context) {
        super(context);
        field = context.getColor(R.color.splash_field);
        ring = context.getColor(R.color.splash_ring);
        logo = context.getDrawable(R.drawable.ic_splash_logo);
        setBackgroundColor(field);
    }

    public void setOnGone(Runnable callback) {
        onGone = callback;
    }

    /** Starts the fade-out; the view removes itself once fully transparent. */
    public void finish() {
        if (finishAt < 0) finishAt = SystemClock.uptimeMillis();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        final long now = SystemClock.uptimeMillis();
        final long elapsed = now - startedAt;
        if (finishAt < 0 && elapsed > WATCHDOG) finishAt = now;

        float fade = 1f;
        if (finishAt >= 0) {
            fade = 1f - Math.min(1f, (now - finishAt) / (float) FADE_OUT);
            if (fade <= 0f) {
                if (!removed) {
                    removed = true;
                    Runnable callback = onGone;
                    if (callback != null) callback.run();
                }
                return;
            }
        }

        final int width = getWidth();
        final int height = getHeight();
        canvas.drawColor(field);
        canvas.saveLayerAlpha(0, 0, width, height, Math.round(255 * fade));

        final float cx = width / 2f;
        final float cy = height / 2f;
        final float maxRadius = Math.min(width, height) * 0.46f;

        // expanding signal rings
        paint.setStyle(Paint.Style.STROKE);
        for (int i = 0; i < 3; i++) {
            long phase = (elapsed + i * (RING_PERIOD / 3)) % RING_PERIOD;
            float t = phase / (float) RING_PERIOD;
            paint.setStrokeWidth(Math.max(1.5f, 3f * (1f - t)));
            paint.setColor(ring);
            paint.setAlpha(Math.round(110 * (1f - t) * fade));
            canvas.drawCircle(cx, cy, maxRadius * (0.28f + 0.72f * t), paint);
        }

        // logo with overshoot scale-in
        float in = Math.min(1f, elapsed / (float) LOGO_IN);
        float overshoot = new AccelerateDecelerateInterpolator().getInterpolation(in);
        float scale = 0.72f + 0.34f * overshoot - 0.06f * overshoot * overshoot;
        int side = Math.round(Math.min(width, height) * 0.34f * scale);
        Rect bounds = new Rect(Math.round(cx - side / 2f), Math.round(cy - side / 2f),
                Math.round(cx + side / 2f), Math.round(cy + side / 2f));
        logo.setBounds(bounds);
        logo.setAlpha(Math.round(255 * Math.min(1f, in * 1.6f) * fade));
        logo.draw(canvas);

        // diagonal light sweep across the logo, once
        if (elapsed > 300 && elapsed < 1300) {
            float t = (elapsed - 300) / 1000f;
            float x = -0.3f * width + t * 1.6f * width;
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xFFFFFFFF);
            paint.setAlpha((int) Math.round(26 * Math.sin(t * (float) Math.PI) * fade));
            canvas.save();
            canvas.rotate(-18f, cx, cy);
            canvas.drawRect(x, cy - side, x + width * 0.14f, cy + side, paint);
            canvas.restore();
        }
        paint.setAlpha(255);
        canvas.restore();
        if (!removed) postInvalidateOnAnimation();
    }
}
