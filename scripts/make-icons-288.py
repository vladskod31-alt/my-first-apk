#!/usr/bin/env python3
"""Package the generated source art into real density-aware launcher resources."""
from pathlib import Path
from PIL import Image, ImageDraw
import base64
R = Path(__file__).resolve().parent.parent
res = R/'app/src/main/res'
source = Image.open(R/'art/libo-288-source.png').convert('RGBA')
source = source.resize((1024,1024), Image.Resampling.LANCZOS)
for density, size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    dest=res/f'mipmap-{density}'; dest.mkdir(exist_ok=True)
    legacy=source.resize((size,size),Image.Resampling.LANCZOS)
    legacy.save(dest/'ic_launcher.png')
    mask=Image.new('L',(size,size));ImageDraw.Draw(mask).ellipse((0,0,size-1,size-1),fill=255)
    rounded=legacy.copy();rounded.putalpha(mask);rounded.save(dest/'ic_launcher_round.png')
    adaptive=int(size*108/48)
    # Main bubble stays within the adaptive 66dp safe circle, including tail.
    fg=Image.new('RGBA',(adaptive,adaptive),(2,4,32,255))
    inner=round(adaptive*.80);fg.alpha_composite(source.resize((inner,inner),Image.Resampling.LANCZOS),((adaptive-inner)//2,)*2)
    fg.save(dest/'ic_launcher_foreground.png')
(res/'drawable/ic_launcher_background.xml').write_text('''<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#020420"/></shape>''')
(res/'drawable/ic_splash_logo.xml').write_text('''<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@mipmap/ic_launcher_foreground" android:gravity="fill" android:filter="true"/>''')
mono='''<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#FFFFFFFF" android:pathData="M54,30 C40,30 30,40 30,54 C30,61 33,67 37,71 L34,79 L44,75 C47,77 51,78 54,78 C68,78 78,67 78,54 C78,40 68,30 54,30 Z"/><path android:fillColor="#FFFFFFFF" android:pathData="M75,32 m-5,0 a5,5 0,1 0,10 0 a5,5 0,1 0,-10 0"/></vector>'''
(res/'drawable/ic_launcher_monochrome.xml').write_text(mono)
(res/'drawable/ic_notification.xml').write_text(mono)
maskable=Image.new('RGBA',(512,512),(2,4,32,255))
maskable.alpha_composite(source.resize((410,410),Image.Resampling.LANCZOS),(51,51))
maskable.save(R/'web/public/icon-512-maskable.png')
for n in [192,512]: source.resize((n,n),Image.Resampling.LANCZOS).save(R/f'web/public/icon-{n}.png')
# Existing UI references icon.svg; embed the same raster, no external fetch.
encoded=base64.b64encode((R/'web/public/icon-192.png').read_bytes()).decode()
(R/'web/public/icon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 192 192"><image width="192" height="192" xlink:href="data:image/png;base64,{encoded}"/></svg>')
print('2.8.8 generated artwork installed in all five launcher densities, adaptive layers, splash and web icons')
