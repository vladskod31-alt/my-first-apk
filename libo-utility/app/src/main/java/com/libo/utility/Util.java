package com.libo.utility;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

public final class Util {
    private Util() {
    }

    /** Decodes an image so that neither side exceeds maxDim pixels (saves memory). */
    public static Bitmap decodeSampled(String path, int maxDim) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, bounds);

        int sample = 1;
        while (bounds.outWidth / sample > maxDim || bounds.outHeight / sample > maxDim) {
            sample *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return BitmapFactory.decodeFile(path, opts);
    }
}
