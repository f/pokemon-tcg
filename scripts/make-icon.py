# The macOS app icon: a Poké Ball on a deep-blue rounded square (Big Sur style), drawn at 4x and scaled down.
#   uv run --with pillow python scripts/make-icon.py   → src-tauri/icons/icon.png (then: npx tauri icon src-tauri/icons/icon.png)
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

S = 4096                      # drawing size (4x the 1024 px icon)
k = S / 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

def box(cx, cy, r):
    return [cx - r, cy - r, cx + r, cy + r]

# --- the rounded square (macOS icon grid: 824 px body inside 1024, ~185 px corners) with a soft shadow
inset, radius = 100 * k, 185 * k
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([inset, inset + 18 * k, S - inset, S - inset + 18 * k], radius, fill=(0, 0, 0, 110))
img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22 * k)))

bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
g = ImageDraw.Draw(bg)
top, bottom = (42, 86, 186), (12, 24, 64)          # blue → navy, like the game's table
for y in range(S):
    t = y / S
    g.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([inset, inset, S - inset, S - inset], radius, fill=255)
body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
body.paste(bg, (0, 0), mask)
# faint light rays behind the ball
rays = Image.new("RGBA", (S, S), (0, 0, 0, 0))
rd = ImageDraw.Draw(rays)
for i in range(16):
    rd.pieslice(box(S / 2, S / 2, S * 0.62), i * 22.5, i * 22.5 + 9, fill=(255, 203, 5, 26))
body.alpha_composite(Image.composite(rays, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
img.alpha_composite(body)

# --- the ball
cx, cy, R = S / 2, S / 2 + 8 * k, 300 * k
ball_shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(ball_shadow).ellipse(box(cx, cy + 40 * k, R * 0.98), fill=(0, 0, 0, 120))
img.alpha_composite(ball_shadow.filter(ImageFilter.GaussianBlur(30 * k)))

ball = Image.new("RGBA", (S, S), (0, 0, 0, 0))
b = ImageDraw.Draw(ball)
ink = (20, 22, 40, 255)
b.ellipse(box(cx, cy, R), fill=ink)                                  # outline
inner = R - 26 * k
red_top, red_bottom = (255, 92, 78), (205, 28, 40)
for y in range(int(cy - inner), int(cy) + 1):                         # red top half, lit from above
    t = (y - (cy - inner)) / inner
    col = tuple(int(red_top[i] + (red_bottom[i] - red_top[i]) * t) for i in range(3)) + (255,)
    half = (inner ** 2 - (y - cy) ** 2) ** 0.5
    b.line([(cx - half, y), (cx + half, y)], fill=col)
for y in range(int(cy), int(cy + inner) + 1):                         # white bottom half
    t = (y - cy) / inner
    c = int(255 - 38 * t)
    half = max(0.0, inner ** 2 - (y - cy) ** 2) ** 0.5
    b.line([(cx - half, y), (cx + half, y)], fill=(c, c, min(255, c + 6), 255))
b.rectangle([cx - R, cy - 30 * k, cx + R, cy + 30 * k], fill=ink)  # the band
b.ellipse(box(cx, cy, 104 * k), fill=ink)                             # the button
b.ellipse(box(cx, cy, 76 * k), fill=(248, 248, 252, 255))
b.ellipse(box(cx, cy, 48 * k), fill=(226, 228, 236, 255))
# keep the ball round: cut everything outside the outline circle
round_mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(round_mask).ellipse(box(cx, cy, R), fill=255)
ball.putalpha(Image.composite(ball.getchannel("A"), Image.new("L", (S, S), 0), round_mask))
img.alpha_composite(ball)

# gloss on the red half
gloss = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(gloss).ellipse([cx - 190 * k, cy - 250 * k, cx - 20 * k, cy - 150 * k], fill=(255, 255, 255, 120))
img.alpha_composite(gloss.filter(ImageFilter.GaussianBlur(18 * k)))

out = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "icon.png"
out.parent.mkdir(parents=True, exist_ok=True)
img.resize((1024, 1024), Image.LANCZOS).save(out)
print("wrote", out)
