from pathlib import Path
from PIL import Image
import json
from math import ceil, sqrt

# === Config ===
IMAGE_ROOT = Path("out")  # your thumbnail directory
OUTPUT_ATLAS = Path("atlas.png")
OUTPUT_JSON = Path("atlas.json")
SPRITE_SIZE = 64  # all images resized to this size
PADDING = 1  # pixels between sprites
IMAGE_TYPES = {".jpg", ".jpeg", ".png"}

# === Load images ===
image_paths = sorted([p for p in IMAGE_ROOT.rglob("*") if p.suffix.lower() in IMAGE_TYPES])
num_images = len(image_paths)

if num_images == 0:
    print(f"No images found in {IMAGE_ROOT}")
    exit(1)

atlas_columns = ceil(sqrt(num_images))
atlas_rows = ceil(num_images / atlas_columns)

atlas_width = atlas_columns * (SPRITE_SIZE + PADDING)
atlas_height = atlas_rows * (SPRITE_SIZE + PADDING)

atlas_image = Image.new("RGBA", (atlas_width, atlas_height), (0, 0, 0, 0))
atlas_data = {}

for idx, path in enumerate(image_paths):
    image_id = str(idx)  # can replace with path.stem if needed
    img = Image.open(path).convert("RGBA").resize((SPRITE_SIZE, SPRITE_SIZE))

    col = idx % atlas_columns
    row = idx // atlas_columns
    x = col * (SPRITE_SIZE + PADDING)
    y = row * (SPRITE_SIZE + PADDING)

    atlas_image.paste(img, (x, y))
    atlas_data[image_id] = {
        "x": x,
        "y": y,
        "width": SPRITE_SIZE,
        "height": SPRITE_SIZE,
        "filename": str(path.relative_to(IMAGE_ROOT))
    }

atlas_image.save(OUTPUT_ATLAS)
with open(OUTPUT_JSON, "w") as f:
    json.dump(atlas_data, f, indent=2)

print(f"✅ Saved atlas with {num_images} images as '{OUTPUT_ATLAS}' and '{OUTPUT_JSON}'")
