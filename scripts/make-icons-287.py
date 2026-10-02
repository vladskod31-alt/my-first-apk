#!/usr/bin/env python3
"""Render the LIBO 2.8.7 icon set (new mark, correct adaptive layers, real splash art).

Why this script replaces scripts/make-icons-28.py
-------------------------------------------------
2.8.0/2.8.1 shipped a broken launcher icon and a black/empty splash screen:

  1. the adaptive layers ``ic_launcher_background.png`` / ``ic_launcher_foreground.png``
     lived **only** in ``mipmap-anydpi-v26``. ``anydpi`` bitmaps are never
     density-scaled, so a 432 px layer is interpreted as 432 dp: on mdpi/hdpi/
     xhdpi/xxhdpi devices the mark was 4-9x too large and every launcher mask
     cropped it away — the user saw a blank or default icon;
  2. the foreground art was drawn at ``safe zone * 1.35``, i.e. outside the 66 dp
     circle that launchers are allowed to crop to;
  3. ``ic_launcher_monochrome.xml`` spanned 18..98 of the 108 viewport, so Android
     13+ themed icons showed a cropped blob instead of the logo;
  4. no splash attributes at all: Android 12+ derived the splash background from
     the theme and drew the (broken) adaptive icon on it, which read as a black
     screen with no logo.

2.8.7 therefore writes:

  * legacy icons in ``mipmap-mdpi..xxxhdpi`` (48/72/96/144/192 px);
  * adaptive background + foreground layers **per density** (108/162/216/324/432 px),
    keeping only the adaptive XML in ``mipmap-anydpi-v26``;
  * a mark that stays inside a 28 dp radius (well within the 33 dp safe zone);
  * monochrome, notification and splash vectors regenerated from the same geometry;
  * web favicon/PWA icons and the 1024 px promo square;
  * ``art/icon-287-preview.png`` — a contact sheet used to review the result.

    python3 scripts/make-icons-287.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "app/src/main/res"

# --- palette (flat 2D, brand colours carried over from 2.8.x) -----------------
BASE = (0x6D, 0x28, 0xD9, 255)     # deep violet field
WEDGE = (0x8B, 0x5C, 0xF6, 255)    # lighter diagonal wedge
BAND = (0x5B, 0x21, 0xB6, 255)     # dark flat rings
ACCENT = (0xC4, 0xB5, 0xFD, 255)   # thin light accent rings
WHITE = (0xFF, 0xFF, 0xFF, 255)
LIME = (0xA3, 0xE6, 0x35, 255)     # brand dot
GREEN = (0x65, 0xA3, 0x0D, 255)   # chevron (darker than 2.8.x: contrast on white)
GREEN_DK = (0x3F, 0x62, 0x12, 255)  # flat chevron shadow
SPLASH = (0x4C, 0x1D, 0x95, 255)   # splash / night field

# 108 dp adaptive viewport. Every mark coordinate stays inside radius 28 of the
# centre, so launcher masks (66 dp safe circle) and the Android 12+ splash icon
# (240 dp of a 288 dp circle) never crop the logo.
VP = 108.0
CX = CY = 54.0

LEGACY_DENSITIES = {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96,
                    "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}
ADAPTIVE_DENSITIES = {"mipmap-mdpi": 108, "mipmap-hdpi": 162, "mipmap-xhdpi": 216,
                      "mipmap-xxhdpi": 324, "mipmap-xxxhdpi": 432}
SUPERSAMPLE = 4


# --- background layer ---------------------------------------------------------
def background(size: int, field=BASE) -> Image.Image:
    """Flat duotone field with concentric signal rings, full 108 dp bleed."""
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), field)
    draw = ImageDraw.Draw(img)
    draw.polygon([(big, 0), (big, big * 0.60), (big * 0.28, 0)], fill=WEDGE)
    cx, cy = -0.40 * big, 1.40 * big

    def disc(radius: float, colour) -> None:
        draw.ellipse([cx - radius * big, cy - radius * big,
                      cx + radius * big, cy + radius * big], fill=colour)

    disc(1.66, BAND)
    disc(1.36, field)
    disc(0.94, BAND)
    disc(0.62, field)

    def ring(radius: float, width: float, colour) -> None:
        layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        rd = ImageDraw.Draw(layer)
        for r, fill in ((radius, colour), (radius - width, (0, 0, 0, 0))):
            rd.ellipse([cx - r * big, cy - r * big, cx + r * big, cy + r * big], fill=fill)
        img.alpha_composite(layer)

    ring(1.70, 0.020, WHITE)
    ring(1.02, 0.015, ACCENT)
    ring(0.58, 0.013, ACCENT)
    return img.resize((size, size), Image.LANCZOS)


# --- the mark (speech bubble + double chevron + brand dot) --------------------
def mark(size: int, scale: float = 1.0, chevrons: bool = True,
         bubble: tuple = WHITE, mono: bool = False) -> Image.Image:
    """Draw the 2.8.7 mark on a transparent canvas of `size` px (108 dp viewport)."""
    big = int(size * SUPERSAMPLE)
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    u = big / VP * scale            # one viewport unit in supersampled pixels
    ox = (big - VP * u) / 2         # keeps the mark centred when scale < 1
    oy = ox

    def pt(x: float, y: float):
        return (ox + x * u, oy + y * u)

    # speech bubble body: rounded rect 30,32 -> 78,70 (r 13)
    x0, y0 = pt(30, 32)
    x1, y1 = pt(78, 70)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=13 * u, fill=bubble)
    # tail: rounded tip near (43, 78), still inside the 66dp safe circle
    tail = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    td = ImageDraw.Draw(tail)
    td.polygon([pt(40, 56), pt(40, 76.6), pt(45.5, 79.2), pt(57, 69.5)], fill=bubble)
    tx, ty = pt(42.6, 75.0)
    td.ellipse([tx - 4.2 * u, ty - 4.2 * u, tx + 4.2 * u, ty + 4.2 * u], fill=bubble)
    img.alpha_composite(tail)

    if mono or not chevrons:
        # monochrome layer: chevrons and dot are punched out of the white bubble
        punch = Image.new("L", (big, big), 0)
        pd = ImageDraw.Draw(punch)
        w = 6.4 * u
        for shift in (0.0, 12.6):
            pd.line([pt(43.6 + shift, 44.6), pt(52.4 + shift, 51.0), pt(43.6 + shift, 57.4)],
                    fill=255, width=int(w), joint="curve")
            for x, y in ((43.6 + shift, 44.6), (52.4 + shift, 51.0), (43.6 + shift, 57.4)):
                px, py = pt(x, y)
                pd.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=255)
        dx, dy = pt(69.6, 42.0)
        pd.ellipse([dx - 3.7 * u, dy - 3.7 * u, dx + 3.7 * u, dy + 3.7 * u], fill=255)
        img.putalpha(Image.composite(Image.new("L", (big, big), 0), img.getchannel("A"), punch))
        return img.resize((size, size), Image.LANCZOS)

    def chevron(shift_x: float, shift_y: float, colour, width: float) -> None:
        w = width * u
        for offset in (0.0, 12.6):
            points = [pt(43.6 + offset + shift_x, 44.6 + shift_y),
                      pt(52.4 + offset + shift_x, 51.0 + shift_y),
                      pt(43.6 + offset + shift_x, 57.4 + shift_y)]
            draw.line(points, fill=colour, width=int(w), joint="curve")
            for px, py in points:
                draw.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=colour)

    chevron(2.0, 2.4, GREEN_DK, 6.4)   # flat long-shadow pass
    chevron(0.0, 0.0, GREEN, 6.4)
    dx, dy = pt(69.6, 42.0)            # brand dot (echoes the "lı" glyph)
    draw.ellipse([dx - 3.7 * u, dy - 3.7 * u, dx + 3.7 * u, dy + 3.7 * u], fill=LIME)
    return img.resize((size, size), Image.LANCZOS)


def foreground(size: int) -> Image.Image:
    """Adaptive foreground layer: the mark only, transparent elsewhere."""
    return mark(size, scale=1.0)


def compose(size: int, field=BASE, mark_scale: float = 1.22) -> Image.Image:
    """Legacy square icon / promo art: full-bleed field plus a larger mark.

    The mark is enlarged only here: the adaptive foreground keeps scale 1.0 so it
    stays inside the 66dp safe zone that launchers crop to.
    """
    img = background(size, field)
    img.alpha_composite(mark(size, scale=mark_scale))
    return img


def round_variant(image: Image.Image) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, image.size[0], image.size[1]], fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def write(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


# --- vector drawables (same geometry as the bitmaps) --------------------------
MONOCHROME_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- 2.8.7: themed-icon layer. Every path stays inside the 66dp safe circle of the
     108dp viewport (radius 28 of centre 54,54); 2.8.1 drew 18..98 and was cropped. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FFFFFF"
        android:pathData="M43,32 H65 A13,13 0 0 1 78,45 V57 A13,13 0 0 1 65,70 H43 A13,13 0 0 1 30,57 V45 A13,13 0 0 1 43,32 Z" />
    <path android:fillColor="#FFFFFF"
        android:pathData="M40,56 V76.6 A4.2,4.2 0 0 0 45.5,79.2 L57,69.5 Z" />
    <path android:fillColor="#00000000" android:strokeColor="#FFFFFF"
        android:strokeWidth="6.4" android:strokeLineCap="round" android:strokeLineJoin="round"
        android:pathData="M43.6,44.6 L52.4,51 L43.6,57.4 M56.2,44.6 L65,51 L56.2,57.4" />
    <path android:fillColor="#FFFFFF"
        android:pathData="M69.6,42 m-3.7,0 a3.7,3.7 0 1 0 7.4,0 a3.7,3.7 0 1 0 -7.4,0" />
</vector>
"""

# Monochrome layers are tinted by the launcher: the bubble is white and the
# chevrons/dot are cut out, which is what the alpha-punched bitmap does too.
MONOCHROME_SILHOUETTE_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- 2.8.7 silhouette used by the notification small icon and the splash mark:
     a solid white bubble with the chevrons and the dot knocked out. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FFFFFF" android:fillType="evenOdd"
        android:pathData="M43,32 H65 A13,13 0 0 1 78,45 V57 A13,13 0 0 1 65,70 H43 A13,13 0 0 1 30,57 V45 A13,13 0 0 1 43,32 Z M40,56 V76.6 A4.2,4.2 0 0 0 45.5,79.2 L57,69.5 Z M43.6,41.4 A3.2,3.2 0 0 0 41.7,47.2 L47.9,51 L41.7,54.8 A3.2,3.2 0 0 0 45.5,60.2 L54.3,53.8 A3.2,3.2 0 0 0 54.3,48.2 L45.5,41.8 A3.2,3.2 0 0 0 43.6,41.4 Z M56.2,41.4 A3.2,3.2 0 0 0 54.3,47.2 L60.5,51 L54.3,54.8 A3.2,3.2 0 0 0 58.1,60.2 L66.9,53.8 A3.2,3.2 0 0 0 66.9,48.2 L58.1,41.8 A3.2,3.2 0 0 0 56.2,41.4 Z M69.6,38.3 A3.7,3.7 0 1 0 69.6,45.7 A3.7,3.7 0 0 0 69.6,38.3 Z" />
</vector>
"""

SPLASH_LOGO_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- 2.8.7 splash mark: drawn inside the 66dp safe zone so the Android 12+ splash
     icon (and the pre-31 windowBackground layer) shows the whole logo. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FFFFFF"
        android:pathData="M43,32 H65 A13,13 0 0 1 78,45 V57 A13,13 0 0 1 65,70 H43 A13,13 0 0 1 30,57 V45 A13,13 0 0 1 43,32 Z" />
    <path android:fillColor="#FFFFFF"
        android:pathData="M40,56 V76.6 A4.2,4.2 0 0 0 45.5,79.2 L57,69.5 Z" />
    <path android:fillColor="#00000000" android:strokeColor="#4C1D95"
        android:strokeWidth="6.4" android:strokeLineCap="round" android:strokeLineJoin="round"
        android:pathData="M43.6,44.6 L52.4,51 L43.6,57.4 M56.2,44.6 L65,51 L56.2,57.4" />
    <path android:fillColor="#A3E635"
        android:pathData="M69.6,42 m-3.7,0 a3.7,3.7 0 1 0 7.4,0 a3.7,3.7 0 1 0 -7.4,0" />
</vector>
"""

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" role="img" aria-label="LIBO">
  <rect width="108" height="108" fill="#6d28d9"/>
  <path d="M108 0v64.8L30.2 0Z" fill="#8b5cf6"/>
  <g fill="#5b21b6" fill-rule="evenodd">
    <path d="M-43.2 151.2a179.3 179.3 0 1 0 0-358.6 179.3 179.3 0 0 0 0 358.6Zm0-32.4a146.9 146.9 0 1 1 0-293.8 146.9 146.9 0 0 1 0 293.8Z"/>
    <path d="M-43.2 151.2a101.5 101.5 0 1 0 0-203 101.5 101.5 0 0 0 0 203Zm0-34.6a66.9 66.9 0 1 1 0-133.8 66.9 66.9 0 0 1 0 133.8Z"/>
  </g>
  <g fill="none" stroke-linecap="round">
    <circle cx="-43.2" cy="151.2" r="183.6" stroke="#fff" stroke-width="2.2"/>
    <circle cx="-43.2" cy="151.2" r="110.2" stroke="#c4b5fd" stroke-width="1.6"/>
    <circle cx="-43.2" cy="151.2" r="62.6" stroke="#c4b5fd" stroke-width="1.4"/>
  </g>
  <rect x="30" y="32" width="48" height="38" rx="13" fill="#fff"/>
  <path d="M40 56v20.6a4.2 4.2 0 0 0 5.5 2.6L57 69.5Z" fill="#fff"/>
  <g fill="none" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="m45.6 47 8.8 6.4-8.8 6.4m12.6-12.8 8.8 6.4-8.8 6.4" stroke="#3f6212"/>
    <path d="m43.6 44.6 8.8 6.4-8.8 6.4m12.6-12.8 8.8 6.4-8.8 6.4" stroke="#65a30d"/>
  </g>
  <circle cx="69.6" cy="42" r="3.7" fill="#a3e635"/>
</svg>
"""


def contact_sheet() -> Image.Image:
    """art/icon-287-preview.png: launcher, legacy, themed and splash variants."""
    pad, cell = 28, 192
    width, height = cell * 4 + pad * 5, cell + pad * 2 + 54
    sheet = Image.new("RGBA", (width, height), (0x12, 0x10, 0x1C, 255))
    labels = ["adaptive 192", "legacy 48 (x4)", "themed mono", "splash (v31+)"]
    tiles = [
        compose(cell),
        compose(48).resize((cell, cell), Image.NEAREST),
        None,
        None,
    ]
    mono = Image.new("RGBA", (cell, cell), (0x2A, 0x27, 0x33, 255))
    mono.alpha_composite(mark(cell, mono=True))
    tiles[2] = mono
    splash = Image.new("RGBA", (cell, cell), SPLASH)
    logo = mark(cell, scale=1.0)
    splash.alpha_composite(logo.resize((cell, cell), Image.LANCZOS), (0, 0))
    tiles[3] = splash
    from PIL import ImageDraw as _D
    draw = _D.Draw(sheet)
    for index, tile in enumerate(tiles):
        x = pad + index * (cell + pad)
        sheet.alpha_composite(tile, (x, pad))
        draw.text((x + 6, pad + cell + 14), labels[index], fill=(0xC4, 0xB5, 0xFD, 255))
    return sheet


def main() -> None:
    # legacy launcher icons
    for folder, size in LEGACY_DENSITIES.items():
        icon = compose(size)
        write(icon, RES / folder / "ic_launcher.png")
        write(round_variant(icon), RES / folder / "ic_launcher_round.png")

    # adaptive layers, one bitmap per density (never in anydpi-v26)
    for folder, size in ADAPTIVE_DENSITIES.items():
        write(background(size), RES / folder / "ic_launcher_background.png")
        write(foreground(size), RES / folder / "ic_launcher_foreground.png")
    for stale in ("ic_launcher_background.png", "ic_launcher_foreground.png"):
        path = RES / "mipmap-anydpi-v26" / stale
        if path.exists():
            path.unlink()
            print(f"removed {path.relative_to(ROOT)} (anydpi bitmaps are never density-scaled)")

    # splash + notification vectors (same geometry, no bitmaps -> small APK)
    (RES / "drawable" / "ic_launcher_monochrome.xml").write_text(MONOCHROME_XML, encoding="utf-8", newline="\n")
    (RES / "drawable" / "ic_notification.xml").write_text(MONOCHROME_SILHOUETTE_XML, encoding="utf-8", newline="\n")
    (RES / "drawable" / "ic_splash_logo.xml").write_text(SPLASH_LOGO_XML, encoding="utf-8", newline="\n")
    print("wrote app/src/main/res/drawable/ic_launcher_monochrome.xml, ic_notification.xml, ic_splash_logo.xml")

    # web + promo
    write(compose(1024), ROOT / "art/libo-2d-1024.png")
    write(compose(512), ROOT / "web/public/icon-512.png")
    write(compose(192), ROOT / "web/public/icon-192.png")
    (ROOT / "web/public/icon.svg").write_text(SVG, encoding="utf-8", newline="\n")
    print("wrote web/public/icon.svg (2.8.7 mark)")
    write(contact_sheet(), ROOT / "art/icon-287-preview.png")


if __name__ == "__main__":
    main()
