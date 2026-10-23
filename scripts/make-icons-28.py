#!/usr/bin/env python3
"""Render the LIBO 2.11.9.5 purple/pink orb icon set.

The same chat-orb mark is exported as legacy Android icons, adaptive icon
layers, the Android monochrome glyph, web PNGs, and an SVG favicon.

Requires Pillow: python3 -m pip install Pillow
Run: python3 scripts/make-icons-28.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
MASTER = 1024
LEGACY_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
ADAPTIVE_PX = 432


def background(size: int) -> Image.Image:
    """Diagonal plum-to-magenta background with quiet orbit details."""
    horizontal = Image.new("L", (size, size), 0)
    vertical = Image.new("L", (size, size), 0)
    hd = ImageDraw.Draw(horizontal)
    vd = ImageDraw.Draw(vertical)
    for x in range(size):
        hd.line((x, 0, x, size), fill=round(255 * x / max(1, size - 1)))
    for y in range(size):
        vd.line((0, y, size, y), fill=round(255 * y / max(1, size - 1)))
    diagonal = Image.blend(horizontal, vertical, 0.47)
    image = ImageOps.colorize(diagonal, black="#210b3b", white="#a8328a").convert("RGBA")

    scale = size / 512
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((282 * scale, -55 * scale, 565 * scale, 228 * scale), fill=(249, 72, 169, 82))
    gd.ellipse((-80 * scale, 307 * scale, 224 * scale, 610 * scale), fill=(116, 72, 241, 68))
    glow = glow.filter(ImageFilter.GaussianBlur(56 * scale))
    image = Image.alpha_composite(image, glow)

    d = ImageDraw.Draw(image, "RGBA")
    d.ellipse((48 * scale, 48 * scale, 464 * scale, 464 * scale), outline=(255, 231, 255, 30), width=max(1, round(2 * scale)))
    d.arc((18 * scale, 18 * scale, 494 * scale, 494 * scale), 204, 300, fill=(255, 180, 228, 78), width=max(1, round(3 * scale)))
    d.arc((42 * scale, 42 * scale, 470 * scale, 470 * scale), 22, 116, fill=(205, 165, 255, 70), width=max(1, round(3 * scale)))
    return image


def make_mark(size: int = MASTER) -> Image.Image:
    """Draw a luminous two-orb chat bubble on a transparent canvas."""
    s = size / 512
    p = lambda x, y: (round(x * s), round(y * s))
    box = lambda x0, y0, x1, y1: tuple(round(v * s) for v in (x0, y0, x1, y1))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    body_box = box(77, 82, 435, 366)
    tail = [p(178, 342), p(150, 424), p(253, 365)]

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    offset = round(7 * s)
    sd.rounded_rectangle((body_box[0], body_box[1] + offset, body_box[2], body_box[3] + offset), radius=78 * s, fill=(15, 5, 32, 122))
    sd.polygon([(x, y + offset) for x, y in tail], fill=(15, 5, 32, 122))
    shadow = shadow.filter(ImageFilter.GaussianBlur(17 * s))
    canvas = Image.alpha_composite(canvas, shadow)

    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle(body_box, radius=78 * s, fill=255)
    md.polygon(tail, fill=255)

    # Build a seamless outer rim from the combined bubble+tail mask so no stroke cuts into the tail.
    stroke_px = max(3, round(3 * s) | 1)
    outer_mask = mask.filter(ImageFilter.MaxFilter(stroke_px * 2 + 1))
    rim_mask = ImageChops.subtract(outer_mask, mask).filter(ImageFilter.GaussianBlur(max(0.5, 0.6 * s)))

    light = Image.linear_gradient("L").resize((size, size))
    bubble = ImageOps.colorize(light, black="#fffaff", white="#e7d8ff").convert("RGBA")
    bubble.putalpha(mask)
    canvas = Image.alpha_composite(canvas, bubble)

    rim = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    rim.putalpha(rim_mask.point(lambda a: round(a * 0.85)))
    canvas = Image.alpha_composite(canvas, rim)

    def orb(cx: float, cy: float, radius: float, light_rgb, edge_rgb) -> None:
        cxp, cyp, rp = round(cx * s), round(cy * s), radius * s
        # Render at 2x supersampling for anti-aliased sphere edges, with off-center 3D radial shading.
        od = ImageDraw.Draw(canvas, "RGBA")
        fx, fy = cxp - rp * 0.28, cyp - rp * 0.30
        steps = 96
        for step in range(steps, 0, -1):
            fraction = step / steps
            r = rp * fraction
            cur_x = fx + (cxp - fx) * fraction
            cur_y = fy + (cyp - fy) * fraction
            edge_weight = fraction ** 0.82
            colour = tuple(round(light_rgb[i] * (1 - edge_weight) + edge_rgb[i] * edge_weight) for i in range(3)) + (255,)
            od.ellipse((round(cur_x - r), round(cur_y - r), round(cur_x + r), round(cur_y + r)), fill=colour)
        # Initialize highlight layer with transparent WHITE (255,255,255,0) so GaussianBlur never bleeds dark fringes.
        highlight = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        hd = ImageDraw.Draw(highlight)
        hd.ellipse((cxp - rp * .60, cyp - rp * .70, cxp - rp * .06, cyp - rp * .24), fill=(255, 255, 255, 130))
        hd.ellipse((cxp - rp * .44, cyp - rp * .60, cxp - rp * .22, cyp - rp * .42), fill=(255, 255, 255, 150))
        highlight = highlight.filter(ImageFilter.GaussianBlur(max(1.0, 5.5 * s)))
        canvas.alpha_composite(highlight)

    orb(207, 231, 68, (228, 191, 255), (102, 44, 192))
    orb(307, 231, 68, (255, 203, 231), (219, 49, 143))

    # Small highlights make the mark read clearly at launcher-icon sizes.
    d = ImageDraw.Draw(canvas, "RGBA")
    d.polygon([p(374, 112), p(380, 128), p(396, 134), p(380, 140), p(374, 156), p(368, 140), p(352, 134), p(368, 128)], fill=(255, 255, 255, 235))
    d.ellipse((*p(117, 151), *p(126, 160)), fill=(245, 213, 255, 230))
    d.ellipse((*p(391, 304), *p(397, 310)), fill=(255, 206, 236, 220))
    return canvas


def fit_mark(size: int, fit: float) -> Image.Image:
    mark = make_mark(MASTER)
    bounds = mark.getbbox()
    if bounds:
        mark = mark.crop(bounds)
    target = round(size * fit)
    scale = min(target / mark.width, target / mark.height)
    width, height = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
    return mark.resize((width, height), Image.Resampling.LANCZOS)


def compose(size: int, fit: float = 0.82) -> Image.Image:
    image = background(MASTER).resize((size, size), Image.Resampling.LANCZOS)
    mark = fit_mark(size, fit)
    image.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return image


def foreground_layer(size: int) -> Image.Image:
    """Keep the foreground inside the adaptive icon's launcher-safe area."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mark = fit_mark(size, 0.43)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


def round_variant(image: Image.Image) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, image.width - 1, image.height - 1), fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def write(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


def write_adaptive_xml(res: Path) -> None:
    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n'
        '</adaptive-icon>\n'
    )
    target = res / "mipmap-anydpi-v26"
    target.mkdir(parents=True, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (target / name).write_text(adaptive, encoding="utf-8", newline="\n")


def write_monochrome_xml(path: Path) -> None:
    xml = '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FFFFFF" android:pathData="M31,26 H77 A12,12 0 0 1 89,38 V62 A12,12 0 0 1 77,74 H53 L38,88 L42,74 H31 A12,12 0 0 1 19,62 V38 A12,12 0 0 1 31,26 Z" />
    <path android:fillColor="#FFFFFF" android:pathData="M42,44 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0" />
    <path android:fillColor="#FFFFFF" android:pathData="M65,44 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0" />
</vector>
'''
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(xml, encoding="utf-8", newline="\n")


def write_svg(path: Path) -> None:
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="LIBO">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#210b3b"/><stop offset=".55" stop-color="#6530a9"/><stop offset="1" stop-color="#b33584"/></linearGradient>
    <linearGradient id="bubble" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fffaff"/><stop offset="1" stop-color="#e7d8ff"/></linearGradient>
    <radialGradient id="violet" cx="30%" cy="25%"><stop stop-color="#e4bfff"/><stop offset="1" stop-color="#662cc0"/></radialGradient>
    <radialGradient id="pink" cx="30%" cy="25%"><stop stop-color="#ffcbe7"/><stop offset="1" stop-color="#db318f"/></radialGradient>
  </defs>
  <rect width="96" height="96" rx="21" fill="url(#bg)"/>
  <circle cx="48" cy="48" r="39" fill="none" stroke="#fce7ff" stroke-opacity=".18" stroke-width=".8"/>
  <path d="M23 19h50a11 11 0 0 1 11 11v28a11 11 0 0 1-11 11H49L34 80l4-11h-15a11 11 0 0 1-11-11V30a11 11 0 0 1 11-11Z" fill="url(#bubble)" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/>
  <circle cx="39" cy="45" r="12" fill="url(#violet)"/>
  <circle cx="57" cy="45" r="12" fill="url(#pink)"/>
  <ellipse cx="35" cy="41" rx="4.5" ry="3.2" fill="#fff" fill-opacity=".55"/>
  <ellipse cx="53" cy="41" rx="4.5" ry="3.2" fill="#fff" fill-opacity=".58"/>
  <path d="m75 13 2.3 5.8 5.7 2.2-5.7 2.3-2.3 5.7-2.2-5.7-5.8-2.3 5.8-2.2L75 13Z" fill="#fff"/>
</svg>
'''
    path.write_text(svg, encoding="utf-8", newline="\n")


def main() -> None:
    res = ROOT / "app/src/main/res"
    for folder, size in LEGACY_DENSITIES.items():
        icon = compose(size)
        write(icon, res / folder / "ic_launcher.png")
        write(round_variant(icon), res / folder / "ic_launcher_round.png")
    write(background(ADAPTIVE_PX), res / "mipmap-anydpi-v26" / "ic_launcher_background.png")
    write(foreground_layer(ADAPTIVE_PX), res / "mipmap-anydpi-v26" / "ic_launcher_foreground.png")
    write(compose(1024), ROOT / "art/libo-2d-1024.png")
    write(compose(512), ROOT / "web/public/icon-512.png")
    write(compose(192), ROOT / "web/public/icon-192.png")
    write_adaptive_xml(res)
    write_monochrome_xml(res / "drawable/ic_launcher_monochrome.xml")
    write_svg(ROOT / "web/public/icon.svg")
    print("wrote the LIBO 2.11.9.5 purple/pink orb icon family")


if __name__ == "__main__":
    main()
