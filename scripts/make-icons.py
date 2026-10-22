"""Generates the extension icons (public/icons/icon{16,32,48,128}.png) from icon.png.

icon.png has its "transparent" checkerboard painted in (no alpha channel). The checkerboard is
perfectly neutral grey/white, while the artwork's light colours are warm cream, so the background
is the neutral-light region connected to the image border. It is made transparent, and the icon
is cropped tight so it fills the whole square at small toolbar sizes.

Usage: python3 scripts/make-icons.py   (requires Pillow)
"""
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
MARGIN = 0.02  # breathing room around the artwork, as a fraction of the icon size

src = Image.open(ROOT / "icon.png").convert("RGB")
w, h = src.size
pixels = src.load()


def is_candidate(x: int, y: int) -> bool:
    """Checkerboard-like pixel: light and neutral (no colour cast)."""
    r, g, b = pixels[x, y]
    return max(r, g, b) - min(r, g, b) <= 3 and min(r, g, b) >= 195


# Flood fill from every border pixel through candidate pixels only.
background = bytearray(w * h)
queue = deque()
border = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
for x, y in border:
    if not background[y * w + x] and is_candidate(x, y):
        background[y * w + x] = 1
        queue.append((x, y))
while queue:
    x, y = queue.popleft()
    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        if 0 <= nx < w and 0 <= ny < h and not background[ny * w + nx] and is_candidate(nx, ny):
            background[ny * w + nx] = 1
            queue.append((nx, ny))

alpha = Image.frombytes("L", (w, h), bytes(0 if v else 255 for v in background))
# Grow the cut by a pixel to drop the anti-aliased checkerboard fringe, then soften the edge.
alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.0))

rgba = src.copy()
rgba.putalpha(alpha)
bbox = alpha.point(lambda v: 255 if v > 16 else 0).getbbox()
art = rgba.crop(bbox)

side = int(max(art.size) * (1 + 2 * MARGIN))
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(art, ((side - art.width) // 2, (side - art.height) // 2), art)

out = ROOT / "public" / "icons"
out.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    square.resize((size, size), Image.LANCZOS).save(out / f"icon{size}.png", optimize=True)
    print(f"wrote public/icons/icon{size}.png")
