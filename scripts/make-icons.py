"""Generates the extension icons (public/icons/icon{16,32,48,128}.png) from icon.png.

The source has an opaque black frame around a rounded white tile. The frame is removed by
flood-filling from the corners into a transparency mask, so the logo's own black stays intact.

Usage: python3 scripts/make-icons.py   (requires Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
src = Image.open(ROOT / "icon.png").convert("RGB")
w, h = src.size

# Mark the outer frame: flood fill near-black pixels connected to the image corners.
mask = Image.new("L", (w, h), 255)
gray = src.convert("L")
marker = gray.point(lambda v: 0 if v < 100 else 255)  # 0 = dark
for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
    if marker.getpixel(corner) == 0:
        ImageDraw.floodfill(marker, corner, 128)  # outer frame becomes 128
mask = marker.point(lambda v: 0 if v == 128 else 255)
# Soften the cut edge slightly for smooth anti-aliasing when scaled down.
mask = mask.filter(ImageFilter.GaussianBlur(1.5))

rgba = src.copy()
rgba.putalpha(mask)
bbox = mask.point(lambda v: 255 if v > 8 else 0).getbbox()
tile = rgba.crop(bbox)
# Pad to a square so the tile is centered.
side = max(tile.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(tile, ((side - tile.width) // 2, (side - tile.height) // 2))

out = ROOT / "public" / "icons"
out.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    square.resize((size, size), Image.LANCZOS).save(out / f"icon{size}.png", optimize=True)
    print(f"wrote public/icons/icon{size}.png")
